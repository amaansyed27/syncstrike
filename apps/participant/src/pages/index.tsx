import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, GameState, LeaderboardEntry, Team } from '@syncstrike/shared-types';

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

  // New state for subpages
  const [activeTab, setActiveTab] = useState<'buzzer' | 'reaction' | 'accuracy'>('buzzer');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);

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

  const fetchAllTeams = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/public/teams`);
      const data = await res.json();
      if (data.success) {
        setAllTeams(data.teams);
      }
    } catch (e) {
      // Handle silently
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
        if (newState.buzzerState === 'LIVE') {
          setLockedReason(null);
          setLeaderboard([]);
        }
      });

      socket.on('leaderboard_update', ({ leaderboard }) => {
        setLeaderboard(leaderboard);
      });

      socket.on('buzz_locked', ({ reason }) => setLockedReason(reason));
      socket.on('buzz_acknowledged', () => setLockedReason('Buzzed successfully! Waiting...'));

      fetchAllTeams(); // Initial fetch for accuracy board

      return () => { socket.disconnect(); };
    }
  }, [joined, teamCode]);

  // Handle Score Polling
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      verifyTeam(teamCode);
      if (activeTab === 'accuracy') fetchAllTeams();
    }, 10000);
    return () => clearInterval(interval);
  }, [joined, teamCode, activeTab]);

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
    setActiveTab('buzzer');
    if (socketRef.current) socketRef.current.disconnect();
  };

  const handleBuzz = () => {
    if (!socketRef.current || !gameState?.activeQuestion) return;
    socketRef.current.emit('buzz', { teamCode, questionId: gameState.activeQuestion.id });
  };

  const getReactionMs = (hitTime: number) => {
    const startTime = gameState?.roundStartTime;
    if (!startTime) return 0;
    return Math.max(0, hitTime - startTime);
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
    <div className={`min-h-screen flex flex-col items-center bg-gray-100 transition-colors duration-200 ${activeTab === 'buzzer' ? btnColor : 'bg-gray-100'}`}>
      
      {/* Persistent Top Bar */}
      <div className="w-full max-w-2xl bg-white border-b-4 border-black shadow-[0px_4px_0px_0px_#000] p-4 flex justify-between items-center z-50 sticky top-0">
        <div>
          <div className="font-black text-xl uppercase leading-none">{teamName}</div>
          <div className="font-bold opacity-50 text-sm">CODE: {teamCode}</div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="font-black text-xl bg-black text-[#3DDC84] px-3 py-1 border-2 border-black">
            {teamScore} PTS
          </div>
          <button onClick={handleLeave} className="border-2 border-black bg-red-500 text-white px-3 py-1 font-bold shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none">
            Leave
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="w-full max-w-2xl flex border-b-4 border-black bg-white sticky top-[72px] z-40">
        <button onClick={() => setActiveTab('buzzer')} className={`flex-1 py-3 font-black uppercase text-sm border-r-4 border-black ${activeTab === 'buzzer' ? 'bg-[#3DDC84]' : 'bg-gray-200'}`}>Buzzer</button>
        <button onClick={() => setActiveTab('reaction')} className={`flex-1 py-3 font-black uppercase text-sm border-r-4 border-black ${activeTab === 'reaction' ? 'bg-[#3DDC84]' : 'bg-gray-200'}`}>Reaction</button>
        <button onClick={() => { setActiveTab('accuracy'); fetchAllTeams(); }} className={`flex-1 py-3 font-black uppercase text-sm ${activeTab === 'accuracy' ? 'bg-[#3DDC84]' : 'bg-gray-200'}`}>Points</button>
      </div>
      
      {/* Content Area */}
      <div className="flex-1 flex flex-col items-center w-full max-w-2xl p-4">
        
        {/* BUZZER TAB */}
        {activeTab === 'buzzer' && (
          <div className="flex-1 flex flex-col items-center justify-center w-full mt-8">
            {gameState?.activeQuestion && (
              <div className="tex
t-center w-full px-6 py-4 bg-white border-4 border-black shadow-[6px_6px_0px_0px_#000] mb-12">
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
        )}

        {/* REACTION TIMES TAB */}
        {activeTab === 'reaction' && (
          <div className="w-full mt-4">
            <h2 className="text-3xl font-black uppercase mb-6 border-b-4 border-black pb-2">Live Reaction Queue</h2>
            {leaderboard.length > 0 ? (
              <div className="space-y-3">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.teamCode} className={`flex items-center text-xl font-bold border-4 border-black p-4 uppercase ${entry.isWrong ? 'bg-red-100 opacity-50 line-through' : entry.teamCode === teamCode ? 'bg-[#3DDC84]' : 'bg-white'}`}>
                    <span className="w-10 h-10 bg-black text-white flex items-center justify-center mr-4 border-2 border-black">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-black">{entry.teamName} {entry.teamCode === teamCode ? '(YOU)' : ''}</span>
                    <span className="bg-white border-2 border-black px-3 py-1 text-lg ml-2">
                      +{getReactionMs(entry.hitTime)}ms
                    </span>
                    {entry.isWrong && <span className="ml-3 text-red-500 text-2xl">❌</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border-4 border-black p-8 text-center shadow-[4px_4px_0px_0px_#000]">
                <p className="text-xl font-bold opacity-50 uppercase">No buzzes recorded for the active question.</p>
              </div>
            )}
          </div>
        )}

        {/* TOTAL ACCURACY TAB */}
        {activeTab === 'accuracy' && (
          <div className="w-full mt-4">
            <h2 className="text-3xl font-black uppercase mb-6 border-b-4 border-black pb-2">Total Scoreboard</h2>
            <div className="space-y-3">
              {[...allTeams].sort((a,b) => b.totalScore - a.totalScore).map((t, idx) => (
                <div key={t.code} className={`flex justify-between items-center text-xl font-bold border-4 border-black p-4 uppercase ${t.code === teamCode ? 'bg-black text-[#3DDC84]' : 'bg-white'}`}>
                  <div className="flex items-center">
                    <span className="opacity-50 mr-4">#{idx + 1}</span>
                    <span>{t.name} {t.code === teamCode ? '(YOU)' : ''}</span>
                  </div>
                  <span className={`border-2 border-black px-4 py-1 ${t.code === teamCode ? 'bg-[#3DDC84] text-black' : 'bg-black text-white'}`}>
                    {t.totalScore}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
