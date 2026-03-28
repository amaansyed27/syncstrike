import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, pubClient, subClient } from './redis';
import { db } from './firebase';
import { ServerToClientEvents, ClientToServerEvents, Question, Team } from '@syncstrike/shared-types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.adapter(createAdapter(pubClient, subClient));

// Mock Data Route
app.post('/api/mock-data', async (req, res) => {
  const adminPass = req.headers.authorization;
  if (adminPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const teamsRef = db.collection('teams');
    const questionsRef = db.collection('questions');

    // Clean up old mock data
    const existingTeams = await teamsRef.get();
    existingTeams.forEach((doc) => doc.ref.delete());
    
    const existingQs = await questionsRef.get();
    existingQs.forEach((doc) => doc.ref.delete());

    // Create 5 Dummy Teams
    const teams = [
      { code: 'ALPHA', name: 'Alpha Squad', totalScore: 0 },
      { code: 'BRAVO', name: 'Bravo Battalion', totalScore: 0 },
      { code: 'CHARL', name: 'Charlie Co', totalScore: 0 },
      { code: 'DELTA', name: 'Delta Force', totalScore: 0 },
      { code: 'ECHOX', name: 'Echo Elements', totalScore: 0 },
    ];

    for (const team of teams) {
      await teamsRef.doc(team.code).set(team);
    }

    // Create 10 Sample Questions
    const questions = Array.from({ length: 10 }).map((_, i) => ({
      id: `q${i + 1}`,
      text: `Mock Question ${i + 1}: What is ${i + 1} + ${i + 1}?`,
      answer: `${(i + 1) * 2}`,
      isComplete: false
    }));

    for (const q of questions) {
      await questionsRef.doc(q.id).set(q);
    }

    res.json({ success: true, message: 'Mock data loaded' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load mock data' });
  }
});

// Admin Route to change buzzer state
app.post('/api/buzzer/toggle', async (req, res) => {
  const adminPass = req.headers.authorization;
  if (adminPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { questionId, isLive } = req.body;
  if (!questionId) return res.status(400).json({ error: 'Missing questionId' });

  await redis.set(`buzzer_state:${questionId}`, isLive ? 'LIVE' : 'LOCKED');
  
  const questionDoc = await db.collection('questions').doc(questionId).get();
  const currentQuestion = questionDoc.exists ? questionDoc.data() as Question : null;

  io.emit('state_update', { isLive, currentQuestion });

  if (isLive) {
    // Optionally wipe previous leaderboard on fresh LIVE
    await redis.del(`syncstrike:leaderboard:${questionId}`);
    // Wipe spam limits
    const keys = await redis.keys(`syncstrike:spam:${questionId}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  res.json({ success: true, isLive });
});

app.post('/api/buzzer/award', async (req, res) => {
  const adminPass = req.headers.authorization;
  if (adminPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { teamCode, pointsToAdd } = req.body;
  
  try {
    const teamRef = db.collection('teams').doc(teamCode);
    await db.runTransaction(async (t) => {
      const doc = await t.get(teamRef);
      if (doc.exists) {
        const newScore = (doc.data()?.totalScore || 0) + pointsToAdd;
        t.update(teamRef, { totalScore: newScore });
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to award points' });
  }
});


io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join_room', ({ role, teamCode }: { role: 'participant' | 'projector' | 'organizer', teamCode?: string }) => {
    if (role === 'participant' && teamCode) {
      socket.join(`team_${teamCode}`);
    } else {
      socket.join(role);
    }
  });

  socket.on('buzz', async ({ teamCode, questionId }: { teamCode: string, questionId: string }) => {
    const hitTime = Date.now();

    // SPAM RULE: Pipeline to INCR and get value
    const spamKey = `syncstrike:spam:${questionId}:${teamCode}`;
    const result = await redis.pipeline().incr(spamKey).expire(spamKey, 3600).exec();
    
    // result is [[null, clicks], [null, 1]]
    const clicks = result?.[0][1] as number;

    if (clicks > 3) {
      socket.emit('buzz_locked', { reason: 'Spam detected. Locked for this round.' });
      return;
    }

    // Check if buzzer is LIVE
    const state = await redis.get(`buzzer_state:${questionId}`);
    if (state !== 'LIVE') {
      socket.emit('buzz_locked', { reason: 'Buzzer is not live.' });
      return;
    }

    // Add to sorted set
    const leaderboardKey = `syncstrike:leaderboard:${questionId}`;
    // ZADD returns 1 if added, 0 if updated. NX ensures they only get recorded once per question
    const zaddResult = await redis.zadd(leaderboardKey, 'NX', hitTime, teamCode);

    if (zaddResult === 1) {
      socket.emit('buzz_acknowledged');
      
      // Fetch top 10 from leaderboard and broadcast to projector
      const topRaw = await redis.zrange(leaderboardKey, 0, 9, 'WITHSCORES');
      const leaderboard = [];
      for (let i = 0; i < topRaw.length; i += 2) {
        leaderboard.push({
          rank: (i / 2) + 1,
          teamCode: topRaw[i],
          hitTime: parseInt(topRaw[i + 1], 10)
        });
      }
      
      io.to('projector').to('organizer').emit('leaderboard_update', { leaderboard });
    } else {
      socket.emit('buzz_locked', { reason: 'Already buzzed.' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`SyncStrike Backend running on port ${PORT}`);
});
