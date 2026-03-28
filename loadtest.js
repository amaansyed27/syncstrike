import ws from 'k6/ws';
import { check } from 'k6';
import exec from 'k6/execution';

// 1000 virtual users (VUs) constantly hitting the socket for 30 seconds.
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
  // Use the production backend URL (WebSocket wss:// protocol for secure connection)
  const url = 'wss://syncstrike-backend-167689707605.asia-south1.run.app/socket.io/?EIO=4&transport=websocket';

  // Randomize team to simulate all 5 mock teams hitting concurrently
  const teams = ['ALPHA', 'BRAVO', 'CHARL', 'DELTA', 'ECHOX'];
  const teamCode = teams[exec.vu.idInTest % teams.length];

  const res = ws.connect(url, null, function (socket) {
    socket.on('open', function () {
      // Connect to the room (Socket.io event format)
      socket.send('42["join_room",{"role":"participant","teamCode":"' + teamCode + '"}]');

      // Wait 1 second to ensure connection, then spam 10 hits rapidly to test the rate limiter
      socket.setTimeout(function () {
        for (let i = 0; i < 10; i++) {
          socket.send('42["buzz",{"teamCode":"' + teamCode + '","questionId":"q1"}]');
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
