# SyncStrike Testing Guide

This guide covers how to test SyncStrike locally using mock data and how to simulate thousands of concurrent WebSocket connections to test the Redis Spam Rule and leaderboard sub-millisecond sorting.

## 1. Running Locally
1. Start a local Redis instance:
   ```bash
   docker run --name syncstrike-redis -p 6379:6379 -d redis
   ```
2. Start the Backend:
   ```bash
   cd apps/backend
   npm run dev
   ```
   *Make sure you create a `.env` file with `ADMIN_PASS=secret` and `REDIS_URL=redis://localhost:6379`.*
   *You also need to provide `FIREBASE_SERVICE_ACCOUNT` either locally or as a string.*

3. Start the Frontends:
   ```bash
   cd apps/organizer && npm run dev
   cd apps/projector && npm run dev
   cd apps/participant && npm run dev
   ```

## 2. Mocking Data
1. Navigate to the Organizer app (http://localhost:3002).
2. Enter the admin passcode (`secret`).
3. Under **System Actions**, click **Load Mock Data (Danger)**.
4. This will trigger a backend route that deletes existing Firestore documents and injects 5 dummy teams (e.g., ALPHA, BRAVO) and 10 mock math questions.
5. The dashboard will automatically refresh and pull down the new mock data. You can now select a question and toggle the buzzer live.

## 3. Load Testing WebSockets (k6)

To ensure the system doesn't buckle under 1,000 hits/sec and that the Redis atomic Spam Rule (`INCR`) correctly rate-limits clients, we can use [k6](https://k6.io/).

### Prerequisites
1. Install [k6](https://k6.io/docs/get-started/installation/).
2. Start your backend and local Redis.

### k6 Script (`loadtest.js`)
Create a file named `loadtest.js` in your root directory:

```javascript
import ws from 'k6/ws';
import { check } from 'k6';
import exec from 'k6/execution';

// 1000 virtual users (VUs) constantly hitting the socket.
export const options = {
  scenarios: {
    buzzer_spam: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
    },
  },
};

export default function () {
  const url = 'ws://localhost:8080/';

  // Randomize team to simulate all 5 mock teams hitting concurrently
  const teams = ['ALPHA', 'BRAVO', 'CHARL', 'DELTA', 'ECHOX'];
  const teamCode = teams[exec.vu.idInTest % teams.length];

  const res = ws.connect(url, null, function (socket) {
    socket.on('open', function () {
      // Connect to the room
      socket.send(JSON.stringify(["join_room", { role: 'participant', teamCode }]));

      // Wait 1 second to ensure connection, then spam 10 hits rapidly to test the rate limiter
      socket.setTimeout(function () {
        for (let i = 0; i < 10; i++) {
          socket.send(JSON.stringify(["buzz", { teamCode, questionId: "q1" }]));
        }
      }, 1000);
    });

    socket.on('message', function (msg) {
      if (msg.includes('buzz_locked')) {
        // Validation: The spam rule correctly identified rapid clicks
        check(msg, {
          'rate limit hit': (m) => m.includes('Spam') || m.includes('Already'),
        });
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 5000);
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}
```

### Running the Test
```bash
k6 run loadtest.js
```

### Expected Results
- Your backend terminal will log connections rapidly.
- Redis will handle `INCR` pipelines to block the clicks after 3.
- If you open the Projector UI during the test, you will see exactly 5 teams listed (one hit each recorded), demonstrating that out of 10,000 total hits (`1000 VUs * 10 clicks`), only the first 5 strictly unique valid hits penetrated the Redis layer and were broadcast.
