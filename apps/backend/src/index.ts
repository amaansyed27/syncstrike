import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, pubClient, subClient } from './redis';
import { db } from './firebase';
import { ServerToClientEvents, ClientToServerEvents, Question, Team, LeaderboardEntry } from '@syncstrike/shared-types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.adapter(createAdapter(pubClient, subClient));

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
  io.to('projector').to('organizer').emit('leaderboard_update', { leaderboard });
  io.to('projector').to('organizer').emit('answering_team', { team: answeringTeam });
}

const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers.authorization !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/api', authMiddleware);

app.post('/api/db/clear', async (req, res) => {
  try {
    const collections = ['teams', 'questions'];
    for (const coll of collections) {
      const snap = await db.collection(coll).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await redis.flushdb();
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

    const teams = [
      { code: 'ALPHA', name: 'Alpha Squad', totalScore: 0 },
      { code: 'BRAVO', name: 'Bravo Battalion', totalScore: 0 },
      { code: 'CHARL', name: 'Charlie Co', totalScore: 0 },
      { code: 'DELTA', name: 'Delta Force', totalScore: 0 },
      { code: 'ECHOX', name: 'Echo Elements', totalScore: 0 },
    ];
    for (const team of teams) await teamsRef.doc(team.code).set(team);

    const questions = Array.from({ length: 10 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Mock Question ${i + 1}: What is ${i + 1} + ${i + 1}?`,
      answer: `${(i + 1) * 2}`,
      isComplete: false
    }));
    for (const q of questions) await questionsRef.doc(q.id).set(q);

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
    const collectionName = type === 'teams' ? 'teams' : 'questions';
    if (mode === 'replace') {
      const snap = await db.collection(collectionName).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    const batch = db.batch();
    if (type === 'teams') {
      data.forEach((t: any) => {
        if (t.code && t.name) {
          batch.set(db.collection('teams').doc(t.code.toUpperCase()), { code: t.code.toUpperCase(), name: t.name, totalScore: 0 }, { merge: true });
        }
      });
    } else {
      data.forEach((q: any) => {
        if (q.id && q.text) {
          batch.set(db.collection('questions').doc(q.id), { id: q.id, text: q.text, answer: q.answer || '', isComplete: false }, { merge: true });
        }
      });
    }
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

app.post('/api/buzzer/toggle', async (req, res) => {
  const { questionId, isLive } = req.body;
  if (!questionId) return res.status(400).json({ error: 'Missing questionId' });

  await redis.set(`buzzer_state:${questionId}`, isLive ? 'LIVE' : 'LOCKED');
  const questionDoc = await db.collection('questions').doc(questionId).get();
  const currentQuestion = questionDoc.exists ? questionDoc.data() as Question : null;

  io.emit('state_update', { isLive, currentQuestion });

  if (isLive) {
    await redis.del(`syncstrike:leaderboard:${questionId}`);
    await redis.del(`syncstrike:wrong:${questionId}`);
    const keys = await redis.keys(`syncstrike:spam:${questionId}:*`);
    if (keys.length > 0) await redis.del(keys);
    io.to('projector').to('organizer').emit('leaderboard_update', { leaderboard: [] });
    io.to('projector').to('organizer').emit('answering_team', { team: null });
  }
  res.json({ success: true, isLive });
});

app.post('/api/buzzer/correct', async (req, res) => {
  const { teamCode, questionId } = req.body;
  try {
    const teamRef = db.collection('teams').doc(teamCode);
    await db.runTransaction(async (t) => {
      const doc = await t.get(teamRef);
      if (doc.exists) {
        const newScore = (doc.data()?.totalScore || 0) + 1;
        t.update(teamRef, { totalScore: newScore });
      }
    });
    await redis.set(`buzzer_state:${questionId}`, 'LOCKED');
    io.emit('state_update', { isLive: false, currentQuestion: null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to award point' });
  }
});

app.post('/api/buzzer/wrong', async (req, res) => {
  const { teamCode, questionId } = req.body;
  try {
    await redis.sadd(`syncstrike:wrong:${questionId}`, teamCode);
    await broadcastLeaderboard(questionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark wrong' });
  }
});

io.on('connection', (socket) => {
  socket.on('join_room', ({ role, teamCode }: { role: 'participant'|'projector'|'organizer', teamCode?: string }) => {
    if (role === 'participant' && teamCode) {
      socket.join(`team_${teamCode}`);
    } else {
      socket.join(role);
    }
  });

  socket.on('buzz', async ({ teamCode, questionId }: { teamCode: string, questionId: string }) => {
    const hitTime = Date.now();
    const spamKey = `syncstrike:spam:${questionId}:${teamCode}`;
    const result = await redis.pipeline().incr(spamKey).expire(spamKey, 3600).exec();
    const clicks = result?.[0][1] as number;

    if (clicks > 3) {
      socket.emit('buzz_locked', { reason: 'Spam detected. Locked for this round.' });
      return;
    }

    const state = await redis.get(`buzzer_state:${questionId}`);
    if (state !== 'LIVE') {
      socket.emit('buzz_locked', { reason: 'Buzzer is not live.' });
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
  console.log(`SyncStrike Backend running on port ${PORT}`);
});
