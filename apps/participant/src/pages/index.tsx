import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, GameState } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ParticipantApp() {
  const [teamCode, setTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamScore, setTeamScore] = useState(0);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  const verifyTeam = async (code: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/verify-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamCode: code })
      });
      const data = await res.json();
      if (data.success) {
        setTeamName(data.team.name);
        setTeamScore(data.team.totalScore);
        setJoined(true);
        localStorage.setItem('team_code', code.toUpperCase());
        setError('');
        return true;
      } else {
        setError(data.error || 'Team not found');
        return false;
      }
    } catch (e) {
      setError('Failed to connect to server');
      return false;
    }
  };

  useEffect(() => {
    const savedCode = localStorage.getItem('team_code');
    if (savedCode) {
      setTeamCode(savedCode);
      verifyTeam(savedCode);
    }
  }, []);

  useEffect(() => {
    if (joined) {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL);
      socketRef.current = socket;

      socket.emit('join_room', { role: 'participant', teamCode });

      socket.on('state_update', (newState) => {
        setGameState(newState);
        if (newState.buzzerState === 'LIVE') setLockedReason(null);
      });

      socket.on('buzz_locked', ({ reason }) => setLockedReason(reason));
      socket.on('buzz_acknowledged', () => setLockedReason('Buzzed successfully! Waiting...'));

      return () => { socket.disconnect(); };
    }
  }, [joined, teamCode]);

  // Handle Score Polling (Optional but nice to keep score updated)
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => verifyTeam(teamCode), 10000);
    return () => clearInterval(interval);
  }, [joined, teamCode]);

  useEffect(() => {
    if (gameState?.buzzerState === 'LIVE' && gameState.endTime) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((gameState.endTime! - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState]);

  const handleJoin = async () => {
    if (teamCode.length > 0) {
      await verifyTeam(teamCode);
    }
  };

  const handleLeave = () => {
    localStorage.removeItem('team_code');
    setJoined(false);
    setTeamCode('');
    setTeamName('');
    if (socketRef.current) socketRef.current.disconnect();
  };

  const handleBuzz = () => {
    if (!socketRef.current || !gameState?.activeQuestion) return;
    socketRef.current.emit('buzz', { teamCode, questionId: gameState.activeQuestion.id });
  };

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-8 max-w-sm w-full space-y-6">
          <h1 className="text-4xl font-black uppercase text-center">Join Game</h1>
          {error && <p className="text-red-500 font-bold text-center border-2 border-red-500 p-2">{error}</p>}
          <input
            type="text"
            className="w-full border-4 border-black p-4 text-2xl text-center font-bold uppercase focus:outline-none"
            placeholder="TEAM CODE"
            maxLength={6}
            value={teamCode}
            onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
          />
          <button
            onClick={handleJoin}
            className="w-full bg-[#3DDC84] text-black border-4 border-black shadow-[4px_4px_0px_0px_#000] py-4 text-2xl font-bold uppercase active:translate-y-1 active:translate-x-1 active:shadow-none transition-all"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  // The huge button logic
  let btnColor = 'bg-white';
  let btnText = 'WAITING';
  let disabled = true;
  
  if (lockedReason) {
    btnColor = 'bg-red-500';
    btnText = lockedReason.includes('Spam') ? 'SPAM LOCKED' : lockedReason.includes('Already') ? 'BUZZED!' : 'LOCKED';
  } else if (gameState?.buzzerState === 'LIVE') {
    btnColor = 'bg-[#3DDC84]';
    btnText = `BUZZ! (${timeLeft}s)`;
    disabled = false;
  } else if (gameState?.buzzerState === 'JUDGING') {
    btnColor = 'bg-yellow-400';
    btnText = 'JUDGING...';
  }

  return (
    <div className={`min-h-screen flex flex-col items-center p-4 transition-colors duration-200 ${btnColor}`}>
      {/* Persistent Top Bar */}
      <div className="w-full max-w-2xl bg-white border-4 border-black shadow-[4px_4px_0px_0px_#000] p-4 flex justify-between items-center mb-8">
        <div>
          <div className="font-black text-xl uppercase leading-none">{teamName}</div>
          <div className="font-bold opacity-50 text-sm">CODE: {teamCode}</div>
        </div>
        <div className="flex items-center space-x-4">
          <div className="font-black text-2xl bg-black text-[#3DDC84] px-4 py-1 border-2 border-black">
            {teamScore} PTS
          </div>
          <button onClick={handleLeave} className="border-2 border-black bg-red-500 text-white px-4 py-2 font-bold shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none">
            Leave
          </button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl">
        {gameState?.activeQuestion && (
          <div className="text-center w-full px-6 py-4 bg-white border-4 border-black shadow-[6px_6px_0px_0px_#000] mb-12">
            <p className="text-2xl font-bold">{gameState.activeQuestion.text}</p>
          </div>
        )}

        <button
          onClick={handleBuzz}
          disabled={disabled}
          className={`w-64 h-64 sm:w-80 sm:h-80 rounded-full border-8 border-black shadow-[8px_8px_0px_0px_#000] font-black text-4xl sm:text-6xl uppercase transition-transform active:translate-y-2 active:translate-x-2 active:shadow-none disabled:active:translate-y-0 disabled:active:translate-x-0 ${btnColor}`}
        >
          {btnText}
        </button>

        {lockedReason && (
          <p className="mt-12 text-xl font-bold bg-white px-6 py-3 border-4 border-black shadow-[4px_4px_0px_0px_#000] text-center max-w-sm">
            {lockedReason}
          </p>
        )}
      </div>
    </div>
  );
}
