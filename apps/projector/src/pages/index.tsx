import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Lottie from 'lottie-react';
import { ClientToServerEvents, ServerToClientEvents, LeaderboardEntry, GameState, Team } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ProjectorApp() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [teamScores, setTeamScores] = useState<Team[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting...');
  const [androidLottie, setAndroidLottie] = useState<object | null>(null);

  const fetchTeamScores = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/public/teams`);
      const data = await res.json();
      if (data.success) {
        setTeamScores(data.teams as Team[]);
      }
    } catch {
      // Keep last known scores if API is temporarily unavailable.
    }
  };

  const getReactionMs = (hitTime: number) => {
    const startTime = gameState?.roundStartTime;
    if (!startTime) return 0;
    return Math.max(0, hitTime - startTime);
  };

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    socket.on('connect', () => {
      setIsSocketConnected(true);
      setConnectionStatus('Connected');
      socket.emit('join_room', { role: 'projector' });
    });

    socket.on('disconnect', () => {
      setIsSocketConnected(false);
      setConnectionStatus('Connection lost. Reconnecting...');
    });

    socket.on('connect_error', () => {
      setIsSocketConnected(false);
      setConnectionStatus('Unable to reach backend. Retrying...');
    });

    socket.io.on('reconnect_attempt', () => {
      setConnectionStatus('Reconnecting...');
    });

    socket.io.on('reconnect', () => {
      setIsSocketConnected(true);
      setConnectionStatus('Reconnected');
      socket.emit('join_room', { role: 'projector' });
    });

    socket.on('state_update', (newState) => {
      setGameState(newState);
      if (newState.buzzerState === 'LIVE') {
        setLeaderboard([]);
      }
      if (newState.projectorView === 'accuracy' || newState.buzzerState === 'LOCKED') {
        fetchTeamScores();
      }
    });

    socket.on('leaderboard_update', ({ leaderboard }) => setLeaderboard(leaderboard));

    return () => { socket.disconnect(); };
  }, []);

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

  useEffect(() => {
    if (gameState?.projectorView !== 'accuracy') return;
    fetchTeamScores();
    const interval = setInterval(fetchTeamScores, 5000);
    return () => clearInterval(interval);
  }, [gameState?.projectorView]);

  useEffect(() => {
    let isMounted = true;
    fetch('/assets/lottie/android-logo.json')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) setAndroidLottie(data);
      })
      .catch(() => {
        // Non-blocking brand animation.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!gameState) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <h1 className="text-[#3DDC84] text-4xl font-black animate-pulse">{connectionStatus.toUpperCase()}</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      {!isSocketConnected && (
        <div className="w-full max-w-6xl mb-4 border-4 border-black bg-yellow-300 px-4 py-3 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000]">
          {connectionStatus}
        </div>
      )}
      <div className="w-full max-w-6xl border-4 border-black bg-white shadow-[6px_6px_0px_0px_#000] px-5 py-3 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/assets/svg-static/pixel-android.svg"
            alt="Android Club Icon"
            className="w-8 h-8 object-contain"
          />
          <p className="font-black uppercase tracking-wider">Android Club • GeekRush • SyncStrike</p>
        </div>
        {androidLottie && (
          <div className="w-14 h-14 border-2 border-black bg-white">
            <Lottie animationData={androidLottie} loop autoplay />
          </div>
        )}
      </div>
      <div className="w-full max-w-6xl space-y-8">
        
        {gameState.projectorView === 'home' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-[1.8fr_1fr] gap-6">
              <div className={`w-full border-8 border-black shadow-[12px_12px_0px_0px_#000] transition-all duration-300 ${gameState.buzzerState === 'LIVE' ? 'bg-[#3DDC84]' : 'bg-white'} ${leaderboard.length > 0 ? 'p-8' : 'p-12'} relative overflow-hidden`}>
                {gameState.buzzerState === 'LIVE' && gameState.endTime && (
                  <div className="absolute bottom-0 left-0 h-3 bg-black transition-all duration-100" style={{ width: `${(timeLeft / 10) * 100}%` }}></div>
                )}
                <h2 className="text-2xl font-black uppercase mb-4 opacity-50">Current Question</h2>
                <h1 className={`font-black leading-tight ${leaderboard.length > 0 ? 'text-4xl xl:text-5xl' : 'text-5xl xl:text-6xl'}`}>
                  {gameState.activeQuestion ? gameState.activeQuestion.text : 'Waiting for Next Question...'}
                </h1>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <div className={`text-xl font-bold uppercase tracking-widest text-white inline-block px-4 py-2 ${gameState.buzzerState === 'LIVE' ? 'bg-black' : gameState.buzzerState === 'JUDGING' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                    Status: {gameState.buzzerState}
                  </div>
                  {gameState.buzzerState === 'LIVE' && (
                    <div className="text-xl font-black bg-white border-4 border-black px-4 py-1">
                      {timeLeft}s
                    </div>
                  )}
                </div>
              </div>

              <div className="w-full border-8 border-black bg-white shadow-[12px_12px_0px_0px_#000] p-6">
                <h3 className="text-2xl font-black uppercase mb-4 border-b-4 border-black pb-2 flex items-center gap-2">
                  <img
                    src="/assets/svg-static/pixel-android.svg"
                    alt="Android Club Icon"
                    className="w-7 h-7 object-contain"
                  />
                  Live Queue
                </h3>
                {leaderboard.length > 0 ? (
                  <div className="space-y-2">
                    {leaderboard.slice(0, 5).map((entry, idx) => (
                      <div key={entry.teamCode} className={`flex items-center justify-between border-2 border-black p-2 text-base font-black uppercase ${entry.isWrong ? 'bg-red-100 opacity-60 line-through' : 'bg-gray-50'}`}>
                        <div className="flex items-center min-w-0">
                          <span className="w-7 h-7 mr-2 border-2 border-black bg-black text-white flex items-center justify-center text-xs">{idx + 1}</span>
                          <span className="truncate">{entry.teamName}</span>
                        </div>
                        <span className="border-2 border-black bg-white px-2 py-0.5 text-sm ml-2 shrink-0">
                          +{getReactionMs(entry.hitTime)}ms
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-base font-bold opacity-50 uppercase">Queue appears here once teams buzz.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {gameState.projectorView === 'reaction' && (
          <div className="w-full border-8 border-black bg-white shadow-[12px_12px_0px_0px_#000] p-12 animate-in fade-in slide-in-from-bottom-8 duration-500">
            <h2 className="text-5xl font-black uppercase mb-12 border-b-8 border-black pb-4">Live Reaction Times</h2>
            {leaderboard.length > 0 ? (
              <div className="space-y-4">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.teamCode} className={`flex items-center text-4xl font-bold border-4 border-black p-6 uppercase ${entry.isWrong ? 'bg-red-100 opacity-50 line-through' : 'bg-gray-50'}`}>
                    <span className="w-16 h-16 bg-black text-white flex items-center justify-center mr-6 border-4 border-black">
                      {idx + 1}
                    </span>
                    <span className="flex-1 drop-shadow-md text-black">{entry.teamName}</span>
                    <span className="bg-white border-4 border-black px-6 py-3 text-2xl ml-4">
                      +{getReactionMs(entry.hitTime)}ms
                    </span>
                    {entry.isWrong && <span className="ml-6 text-red-500 text-5xl">❌</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-4xl font-bold opacity-50">No buzzes recorded.</p>
            )}
          </div>
        )}

        {gameState.projectorView === 'accuracy' && (
          <div className="w-full border-8 border-black bg-white shadow-[12px_12px_0px_0px_#000] p-12 animate-in fade-in slide-in-from-bottom-8 duration-500">
            <h2 className="text-5xl font-black uppercase mb-12 border-b-8 border-black pb-4">Total Scoreboard</h2>
            {teamScores.length > 0 ? (
              <div className="space-y-4">
                {[...teamScores]
                  .sort((a, b) => b.totalScore - a.totalScore)
                  .map((team, idx) => (
                    <div key={team.code} className="flex items-center justify-between border-4 border-black p-5 text-3xl font-black uppercase bg-gray-50">
                      <div className="flex items-center">
                        <span className="w-16 mr-5 text-center opacity-50">#{idx + 1}</span>
                        <span>{team.name}</span>
                      </div>
                      <span className="border-4 border-black bg-black text-[#3DDC84] px-5 py-2 text-2xl">
                        {team.totalScore}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-3xl font-bold opacity-50 italic">No score data yet.</p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
