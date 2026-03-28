import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, Question, LeaderboardEntry, GameState } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ProjectorApp() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answeringTeam, setAnsweringTeam] = useState<LeaderboardEntry | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL);
    socket.emit('join_room', { role: 'projector' });

    socket.on('state_update', (newState) => {
      setGameState(newState);
      if (newState.buzzerState === 'LIVE') {
        setLeaderboard([]);
        setAnsweringTeam(null);
      }
    });

    socket.on('leaderboard_update', ({ leaderboard }) => setLeaderboard(leaderboard));
    socket.on('answering_team', ({ team }) => setAnsweringTeam(team));

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

  if (!gameState) return <div className="min-h-screen bg-black flex items-center justify-center"><h1 className="text-[#3DDC84] text-4xl font-black animate-pulse">CONNECTING...</h1></div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      <div className="w-full max-w-6xl space-y-8">
        
        {gameState.projectorView === 'home' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className={`w-full border-8 border-black shadow-[12px_12px_0px_0px_#000] p-12 transition-all duration-500 ${gameState.buzzerState === 'LIVE' ? 'bg-[#3DDC84]' : 'bg-white'} ${answeringTeam ? 'scale-95 opacity-50' : 'scale-100'} relative overflow-hidden`}>
              {gameState.buzzerState === 'LIVE' && gameState.endTime && (
                <div className="absolute bottom-0 left-0 h-4 bg-black transition-all duration-100" style={{ width: `${(timeLeft / 10) * 100}%` }}></div>
              )}
              <h2 className="text-3xl font-black uppercase mb-4 opacity-50">Current Question</h2>
              <h1 className="text-6xl font-black leading-tight">
                {gameState.activeQuestion ? gameState.activeQuestion.text : 'Waiting for Next Question...'}
              </h1>
              <div className="mt-8 flex items-center space-x-4">
                <div className={`text-2xl font-bold uppercase tracking-widest text-white inline-block px-4 py-2 ${gameState.buzzerState === 'LIVE' ? 'bg-black' : gameState.buzzerState === 'JUDGING' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                  Status: {gameState.buzzerState}
                </div>
                {gameState.buzzerState === 'LIVE' && (
                  <div className="text-2xl font-black bg-white border-4 border-black px-4 py-1">
                    {timeLeft}s
                  </div>
                )}
              </div>
            </div>

            {/* Huge First Click Display */}
            {answeringTeam && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 p-8">
                <div className="w-full max-w-5xl bg-white border-8 border-black p-16 text-center animate-bounce shadow-[16px_16px_0px_0px_#000]">
                  <h2 className="text-4xl font-black uppercase mb-4 opacity-50">Buzz! We have a response from:</h2>
                  <h1 className="text-7xl font-black uppercase text-[#3DDC84] drop-shadow-md mb-8 leading-none">{answeringTeam.teamName}</h1>
                  <div className="text-4xl font-bold bg-black text-white inline-block px-6 py-3 border-4 border-black">
                    +{answeringTeam.hitTime - leaderboard[0].hitTime}ms
                  </div>
                </div>
              </div>
            )}
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
                      +{entry.hitTime - (leaderboard[0]?.hitTime || entry.hitTime)}ms
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
            <div className="space-y-6">
              <p className="text-3xl font-bold opacity-50 italic">Scores are managed by the Organizer Dashboard.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
