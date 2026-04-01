import * as admin from 'firebase-admin';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, pubClient, subClient } from './redis';
import { db } from './firebase';
import { ServerToClientEvents, ClientToServerEvents, Question, Team, LeaderboardEntry, GameState, BuzzerState, ProjectorView } from '@syncstrike/shared-types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.adapter(createAdapter(pubClient, subClient));

// Global State Management
async function getGameState(): Promise<GameState> {
  const stateStr = await redis.get('syncstrike:game_state');
  if (!stateStr) {
    const defaultState: GameState = { buzzerState: 'LOCKED', activeQuestion: null, projectorView: 'home' };
    await redis.set('syncstrike:game_state', JSON.stringify(defaultState));
    return defaultState;
  }
  return JSON.parse(stateStr);
}

async function updateGameState(updates: Partial<GameState>): Promise<GameState> {
  const currentState = await getGameState();
  const newState = { ...currentState, ...updates };
  if (updates.buzzerState && updates.buzzerState !== 'LIVE') {
    delete newState.endTime;
  }
  if (updates.buzzerState === 'LOCKED') {
    delete newState.roundStartTime;
  }
  await redis.set('syncstrike:game_state', JSON.stringify(newState));
  io.emit('state_update', newState);
  return newState;
}

async function getTeamName(teamCode: string): Promise<string> {
  const cached = await redis.get(`team_name:${teamCode}`);
  if (cached) return cached;
  const doc = await db.collection('teams').doc(teamCode).get();
  const name = doc.exists ? (doc.data() as Team).name : teamCode;
  await redis.set(`team_name:${teamCode}`, name, 'EX', 86400);
  return name;
}

async function broadcastLeaderboard(questionId: string) {
  const leaderboardKey = `syncstrike:leaderboard:${questionId}`;
  const wrongTeamsKey = `syncstrike:wrong:${questionId}`;
  const topRaw = await redis.zrange(leaderboardKey, 0, -1, 'WITHSCORES');
  const wrongTeams = await redis.smembers(wrongTeamsKey);
  const leaderboard: LeaderboardEntry[] = [];
  let answeringTeam: LeaderboardEntry | null = null;
  let rankOffset = 1;

  for (let i = 0; i < topRaw.length; i += 2) {
    const teamCode = topRaw[i];
    const hitTime = parseInt(topRaw[i + 1], 10);
    const isWrong = wrongTeams.includes(teamCode);
    const teamName = await getTeamName(teamCode);

    const entry: LeaderboardEntry = {
      rank: rankOffset++,
      teamCode,
      teamName,
      hitTime,
      isWrong
    };
    leaderboard.push(entry);

    if (!isWrong && !answeringTeam) {
      answeringTeam = entry;
    }
  }
  io.emit('leaderboard_update', { leaderboard });
  io.emit('answering_team', { team: answeringTeam });
}

// === AUTH & PUBLIC ENDPOINTS ===

app.post('/api/verify-passcode', (req, res) => {
  if (req.headers.authorization === process.env.ADMIN_PASS) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

app.post('/api/verify-team', async (req, res) => {
  const { teamCode } = req.body;
  if (!teamCode) return res.status(400).json({ error: 'Missing teamCode' });
  const code = teamCode.toUpperCase();
  const doc = await db.collection('teams').doc(code).get();
  if (doc.exists) {
    return res.json({ success: true, team: doc.data() });
  }
  res.status(404).json({ error: 'Team not found' });
});

app.get('/api/public/teams', async (req, res) => {
  const snap = await db.collection('teams').get();
  const teams = snap.docs.map(d => d.data());
  res.json({ success: true, teams });
});

// === ADMIN MIDDLEWARE ===
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers.authorization !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/api', authMiddleware);

// === CRUD & DB ACTIONS ===

app.post('/api/db/clear', async (req, res) => {
  try {
    for (const coll of ['teams', 'questions']) {
      const snap = await db.collection(coll).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await redis.flushdb();
    await updateGameState({ buzzerState: 'LOCKED', activeQuestion: null, projectorView: 'home' });
    res.json({ success: true, message: 'Database wiped.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear db' });
  }
});

app.post('/api/mock-data', async (req, res) => {
  try {
    const teamsRef = db.collection('teams');
    const questionsRef = db.collection('questions');

    const existingTeams = await teamsRef.get();
    existingTeams.forEach((doc) => doc.ref.delete());
    const existingQs = await questionsRef.get();
    existingQs.forEach((doc) => doc.ref.delete());

    const teams = Array.from({ length: 50 }).map((_, i) => ({
      code: `T${String(i + 1).padStart(3, '0')}`,
      name: `Mock Team ${i + 1}`,
      totalScore: 0
    }));
    for (const team of teams) await teamsRef.doc(team.code).set(team);

    const questions = Array.from({ length: 10 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Mock Question ${i + 1}: What is ${i + 1} + ${i + 1}?`,
      answer: `${(i + 1) * 2}`,
      isComplete: false
    }));
    for (const q of questions) await questionsRef.doc(q.id).set(q);

    await redis.flushdb();
    await updateGameState({ buzzerState: 'LOCKED', activeQuestion: null, projectorView: 'home' });

    res.json({ success: true, message: 'Mock data loaded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load mock data' });
  }
});

app.post('/api/teams', async (req, res) => {
  const { code, name } = req.body;
  await db.collection('teams').doc(code).set({ code, name, totalScore: 0 }, { merge: true });
  await redis.del(`team_name:${code}`);
  res.json({ success: true });
});

app.delete('/api/teams/:code', async (req, res) => {
  await db.collection('teams').doc(req.params.code).delete();
  res.json({ success: true });
});

app.post('/api/questions', async (req, res) => {
  const { id, text, answer } = req.body;
  const qId = id || `q_${Date.now()}`;
  await db.collection('questions').doc(qId).set({ id: qId, text, answer, isComplete: false }, { merge: true });
  res.json({ success: true });
});

app.delete('/api/questions/:id', async (req, res) => {
  await db.collection('questions').doc(req.params.id).delete();
  res.json({ success: true });
});

app.post('/api/bulk', async (req, res) => {
  const { type, mode, data } = req.body;
  try {
    const coll = type === 'teams' ? 'teams' : 'questions';
    const existingSnap = await db.collection(coll).get();
    const existingIds = new Set(existingSnap.docs.map(d => d.id));

    if (mode === 'replace') {
      const batch = db.batch();
      existingSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      existingIds.clear(); // Because they are all deleted now
    }

    const batch = db.batch();
    data.forEach((item: any) => {
      if (type === 'teams' && item.code && item.name) {
        const code = item.code.toUpperCase();
        const payload: any = { code, name: item.name };
        if (!existingIds.has(code)) {
          payload.totalScore = 0;
        }
        batch.set(db.collection('teams').doc(code), payload, { merge: true });
      } else if (type === 'questions' && item.id && item.text) {
        const payload: any = { id: item.id, text: item.text, answer: item.answer || '' };
        if (!existingIds.has(item.id)) {
          payload.isComplete = false;
          payload.isSkipped = false;
        }
        batch.set(db.collection('questions').doc(item.id), payload, { merge: true });
      }
    });
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

// === PROJECTOR VIEW ===
app.post('/api/projector/view', async (req, res) => {
  const { view } = req.body;
  await updateGameState({ projectorView: view });
  res.json({ success: true });
});

// === GAME ENGINE ===
let currentTimer: NodeJS.Timeout | null = null;

app.post('/api/buzzer/start', async (req, res) => {
  const state = await getGameState();
  let question 
= state.activeQuestion;

  if (!question) {
    // Fetch a random uncompleted question
    const qSnap = await db.collection('questions').where('isComplete', '==', false).get();
    if (qSnap.empty) return res.status(400).json({ error: 'No uncompleted questions left!' });
    const qs = qSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Question);
    question = qs[Math.floor(Math.random() * qs.length)];
  }

  const qId = question.id;
  await redis.del(`syncstrike:leaderboard:${qId}`);
  await redis.del(`syncstrike:wrong:${qId}`);
  const keys = await redis.keys(`syncstrike:spam:${qId}:*`);
  if (keys.length > 0) await redis.del(keys);
  
  io.emit('leaderboard_update', { leaderboard: [] });
  io.emit('answering_team', { team: null });

  const roundStartTime = Date.now();
  const endTime = roundStartTime + 10000;
  await updateGameState({ buzzerState: 'LIVE', activeQuestion: question, endTime, roundStartTime, projectorView: 'home' });

  if (currentTimer) clearTimeout(currentTimer);
  currentTimer = setTimeout(async () => {
    const s = await getGameState();
    if (s.buzzerState === 'LIVE') {
      await updateGameState({ buzzerState: 'JUDGING' });
    }
  }, 10000);

  res.json({ success: true, question });
});

app.post('/api/buzzer/reopen', async (req, res) => {
  const state = await getGameState();
  if (!state.activeQuestion) return res.status(400).json({ error: 'No active question' });
  const qId = state.activeQuestion.id;
  
  await redis.del(`syncstrike:leaderboard:${qId}`);
  await redis.del(`syncstrike:wrong:${qId}`);
  io.emit('leaderboard_update', { leaderboard: [] });
  io.emit('answering_team', { team: null });

  const roundStartTime = Date.now();
  const endTime = roundStartTime + 10000;
  await updateGameState({ buzzerState: 'LIVE', endTime, roundStartTime, projectorView: 'home' });

  if (currentTimer) clearTimeout(currentTimer);
  currentTimer = setTimeout(async () => {
    const s = await getGameState();
    if (s.buzzerState === 'LIVE') {
      await updateGameState({ buzzerState: 'JUDGING' });
    }
  }, 10000);

  res.json({ success: true });
});

app.post('/api/buzzer/stop', async (req, res) => {
  if (currentTimer) clearTimeout(currentTimer);
  await updateGameState({ buzzerState: 'JUDGING' });
  res.json({ success: true });
});

app.post('/api/buzzer/skip', async (req, res) => {
  const state = await getGameState();
  if (state.activeQuestion) {
    await db.collection('questions').doc(state.activeQuestion.id).update({ isSkipped: true });
  }

  if (currentTimer) clearTimeout(currentTimer);
  await updateGameState({ buzzerState: 'LOCKED', activeQuestion: null });
  io.emit('leaderboard_update', { leaderboard: [] });
  io.emit('answering_team', { team: null });
  res.json({ success: true });
});

app.post('/api/buzzer/correct', async (req, res) => {
  const state = await getGameState();
  const qId = state.activeQuestion?.id;
  const { teamCode, teamName } = req.body;
  if (!qId || !teamCode) return res.status(400).json({ error: 'Missing data' });

  try {
    const teamRef = db.collection('teams').doc(teamCode);
    await db.runTransaction(async (t) => {
      const doc = await t.get(teamRef);
      if (doc.exists) {
        t.update(teamRef, { totalScore: (doc.data()?.totalScore || 0) + 1 });
      }
    });

    await db.collection('questions').doc(qId).update({ 
      isComplete: true, 
      winnerCode: teamCode,
      winnerName: teamName || teamCode
    });

    if (currentTimer) clearTimeout(currentTimer);
    await updateGameState({ buzzerState: 'LOCKED', activeQuestion: null });
    io.emit('leaderboard_update', { leaderboard: [] });
    io.emit('answering_team', { team: null });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to award point' });
  }
});

app.post('/api/buzzer/wrong', async (req, res) => {
  const state = await getGameState();
  const qId = state.activeQuestion?.id;
  const { teamCode } = req.body;
  if (!qId || !teamCode) return res.status(400).json({ error: 'Missing data' });

  try {
    await redis.sadd(`syncstrike:wrong:${qId}`, teamCode);
    await broadcastLeaderboard(qId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark wrong' });
  }
});

// === WEBSOCKETS ===
io.on('connection', async (socket) => {
  const state = await getGameState();
  socket.emit('state_update', state);
  if (state.activeQuestion) {
    await broadcastLeaderboard(state.activeQuestion.id);
  }

  socket.on('join_room', ({ role, teamCode }) => {
    if (role === 'participant' && teamCode) {
      socket.join(`team_${teamCode}`);
    } else {
      socket.join(role);
    }
  });

  socket.on('buzz', async ({ teamCode, questionId }) => {
    const hitTime = Date.now();
    const state = await getGameState();
    
    // Only accept buzzes if LIVE and question matches
    if (state.buzzerState !== 'LIVE' || state.activeQuestion?.id !== questionId) {
      socket.emit('buzz_locked', { reason: 'Buzzer is not active.' });
      return;
    }

    const spamKey = `syncstrike:spam:${questionId}:${teamCode}`;
    const result = await redis.pipeline().incr(spamKey).expire(spamKey, 3600).exec();
    const clicks = result?.[0][1] as number;

    if (clicks > 3) {
      socket.emit('buzz_locked', { reason: 'Spam detected. Locked for this round.' });
      return;
    }

    const leaderboardKey = `syncstrike:leaderboard:${questionId}`;
    const zaddResult = await redis.zadd(leaderboardKey, 'NX', hitTime, teamCode);

    if (zaddResult === 1) {
      socket.emit('buzz_acknowledged');
      await broadcastLeaderboard(questionId);
    } else {
      socket.emit('buzz_locked', { reason: 'Already buzzed.' });
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`SyncStrike V3 Backend running on port ${PORT}`);
});

app.post('/api/db/reset-game', async (req, res) => {
  try {
    // Reset all team scores to 0
    const teamsSnap = await db.collection('teams').get();
    const teamBatch = db.batch();
    teamsSnap.docs.forEach(doc => {
      teamBatch.update(doc.ref, { totalScore: 0 });
    });
    await teamBatch.commit();

    // Reset all questions to uncompleted
    const qsSnap = await db.collection('questions').get();
    const qsBatch = db.batch();
    qsSnap.docs.forEach(doc => {
      qsBatch.update(doc.ref, { 
        isComplete: false,
        isSkipped: admin.firestore.FieldValue.delete(),
        winnerCode: admin.firestore.FieldValue.delete(),
        winnerName: admin.firestore.FieldValue.delete()
      });
    });
    await qsBatch.commit();

    // Clear Redis State
    await redis.flushdb();
    await updateGameState({ buzzerState: 'LOCKED', activeQuestion: null, projectorView: 'home' });

    res.json({ success: true, message: 'Game reset successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset game' });
  }
});
