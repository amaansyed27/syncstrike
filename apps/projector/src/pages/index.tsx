import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, Question, LeaderboardEntry, Team } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ProjectorApp() {
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [teams, setTeams] = useState<Team[]>([]); // Assuming we fetch or receive this

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL);

    socket.emit('join_room', { role: 'projector' });

    socket.on('state_update', ({ isLive, currentQuestion }) => {
      setIsLive(isLive);
      setCurrentQuestion(currentQuestion);
      if (isLive) setLeaderboard([]);
    });

    socket.on('leaderboard_update', ({ leaderboard }) => {
      setLeaderboard(leaderboard);
    });

    // In a full implementation, you'd fetch or receive the updated teams via WS or REST
    // For now, we will leave the teams array empty or poll it if needed.

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      <div className="w-full max-w-6xl space-y-8">
        
        {/* Question Banner */}
        <div className={`w-full border-8 border-black box-shadow-brutal p-12 transition-colors duration-500 ${isLive ? 'bg-[#3DDC84]' : 'bg-white'}`}>
          <h2 className="text-3xl font-black uppercase mb-4 opacity-50">Current Question</h2>
          <h1 className="text-6xl font-black leading-tight">
            {currentQuestion ? currentQuestion.text : 'Waiting for Organizer...'}
          </h1>
          <div className="mt-8 text-2xl font-bold uppercase tracking-widest bg-black text-white inline-block px-4 py-2">
            Status: {isLive ? 'LIVE' : 'LOCKED'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Live Reaction Leaderboard */}
          <div className="w-full border-8 border-black bg-white box-shadow-brutal p-8">
            <h2 className="text-4xl font-black uppercase mb-8 border-b-8 border-black pb-4">Live Reaction Times</h2>
            {leaderboard.length > 0 ? (
              <div className="space-y-4">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.teamCode} className="flex items-center text-3xl font-bold border-4 border-black p-4 bg-gray-50 uppercase">
                    <span className="w-12 h-12 bg-black text-white flex items-center justify-center mr-4 border-4 border-black">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-[#3DDC84] drop-shadow-md">{entry.teamCode}</span>
                    <span className="bg-white border-4 border-black px-4 py-2 text-xl">
                      +{entry.hitTime - (leaderboard[0]?.hitTime || entry.hitTime)}ms
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xl font-bold opacity-50">Waiting for buzzes...</p>
            )}
          </div>

          {/* Total Accuracy Leaderboard */}
          <div className="w-full border-8 border-black bg-white box-shadow-brutal p-8">
            <h2 className="text-4xl font-black uppercase mb-8 border-b-8 border-black pb-4">Total Accuracy</h2>
            <div className="space-y-4">
               {/* This would map over the teams array sorted by totalScore */}
               <p className="text-xl font-bold opacity-50 italic">Scores are managed by the Organizer Dashboard</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
