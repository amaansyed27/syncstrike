import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, Question } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ParticipantApp() {
  const [teamCode, setTeamCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    const savedCode = localStorage.getItem('team_code');
    if (savedCode) {
      setTeamCode(savedCode);
      setJoined(true);
    }
  }, []);

  useEffect(() => {
    if (joined) {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL);
      socketRef.current = socket;

      socket.emit('join_room', { role: 'participant', teamCode });

      socket.on('state_update', ({ isLive: newIsLive, currentQuestion: newQ }) => {
        setIsLive(newIsLive);
        setCurrentQuestion(newQ);
        if (newIsLive) setLockedReason(null);
      });

      socket.on('buzz_locked', ({ reason }) => {
        setLockedReason(reason);
      });

      socket.on('buzz_acknowledged', () => {
        setLockedReason('Buzzed successfully! Waiting for next question.');
      });

      return () => {
        socket.disconnect();
      };
    }
  }, [joined, teamCode]);

  const handleJoin = () => {
    if (teamCode.length > 0) {
      localStorage.setItem('team_code', teamCode.toUpperCase());
      setJoined(true);
    }
  };

  const handleLeave = () => {
    localStorage.removeItem('team_code');
    setJoined(false);
    setTeamCode('');
    if (socketRef.current) socketRef.current.disconnect();
  };

  const handleBuzz = () => {
    if (!socketRef.current || !currentQuestion) return;
    socketRef.current.emit('buzz', { teamCode, questionId: currentQuestion.id });
  };

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
        <div className="bg-white border-4 border-black box-shadow-brutal p-8 max-w-sm w-full space-y-6">
          <h1 className="text-4xl font-black uppercase text-center">Join Game</h1>
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
            className="w-full bg-[#3DDC84] text-black border-4 border-black box-shadow-brutal py-4 text-2xl font-bold uppercase hover:translate-y-1 hover:translate-x-1 hover:shadow-none transition-all"
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
  
  if (lockedReason) {
    btnColor = 'bg-red-500';
    btnText = lockedReason.includes('Spam') ? 'LOCKED (SPAM)' : lockedReason.includes('Already') ? 'BUZZED!' : 'LOCKED';
  } else if (isLive) {
    btnColor = 'bg-[#3DDC84]';
    btnText = 'BUZZ!';
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-200 ${btnColor}`}>
      <div className="absolute top-4 left-4 flex space-x-2">
        <div className="border-4 border-black bg-white px-4 py-2 font-bold box-shadow-brutal flex items-center justify-center">
          TEAM: {teamCode}
        </div>
        <button onClick={handleLeave} className="border-4 border-black bg-red-500 text-white px-4 py-2 font-bold box-shadow-brutal active:translate-y-1 active:translate-x-1 active:shadow-none">
          Leave
        </button>
      </div>
      
      {currentQuestion && (
        <div className="absolute top-24 text-center max-w-2xl px-4 py-2 bg-white border-4 border-black box-shadow-brutal">
          <p className="text-xl font-bold">{currentQuestion.text}</p>
        </div>
      )}

      <button
        onClick={handleBuzz}
        disabled={lockedReason !== null || !isLive}
        className={`w-64 h-64 sm:w-80 sm:h-80 rounded-full border-8 border-black box-shadow-brutal font-black text-4xl sm:text-6xl uppercase transition-transform active:translate-y-2 active:translate-x-2 active:shadow-none disabled:active:translate-y-0 disabled:active:translate-x-0 ${btnColor}`}
      >
        {btnText}
      </button>

      {lockedReason && (
        <p className="mt-8 text-xl font-bold bg-white px-4 py-2 border-4 border-black box-shadow-brutal text-center max-w-sm">
          {lockedReason}
        </p>
      )}
    </div>
  );
}
