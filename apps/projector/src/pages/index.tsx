import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents, Question, LeaderboardEntry, Team } from '@syncstrike/shared-types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function ProjectorApp() {
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answeringTeam, setAnsweringTeam] = useState<LeaderboardEntry | null>(null);
  
  // App State: 'home' | 'leaderboard'
  const [activeTab, setActiveTab] = useState<'home' | 'leaderboard'>('home');

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL);
    socket.emit('join_room', { role: 'projector' });

    socket.on('state_update', ({ isLive, currentQuestion }) => {
      setIsLive(isLive);
      setCurrentQuestion(currentQuestion);
      if (isLive) {
        setLeaderboard([]);
        setAnsweringTeam(null);
        setActiveTab('home'); // Auto snap to home when live
      }
    });

    socket.on('leaderboard_update', ({ leaderboard }) => {
      setLeaderboard(leaderboard);
    });

    socket.on('answering_team', ({ team }) => {
      setAnsweringTeam(team);
    });

    return () => { socket.disconnect(); };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      <div className="w-full max-w-6xl space-y-8">
        
        {/* Navigation Tabs (Invisible on actual projector, useful for testing or remote control) */}
        <div className="flex space-x-4 mb-8">
          <button onClick={() => setActiveTab('home')} className={`px-8 py-4 text-2xl font-black border-8 border-black box-shadow-brutal uppercase ${activeTab === 'home' ? 'bg-[#3DDC84]' : 'bg-white'}`}>Home</button>
          <button onClick={() => setActiveTab('leaderboard')} className={`px-8 py-4 text-2xl font-black border-8 border-black box-shadow-brutal uppercase ${activeTab === 'leaderboard' ? 'bg-[#3DDC84]' : 'bg-white'}`}>Leaderboards</button>
        </div>

        {activeTab === 'home' && (
          <div className="space-y-8 animate-in fade-in zoom-in duration-500">
            {/* Question Banner */}
            <div className={`w-full border-8 border-black box-shadow-brutal p-12 transition-all duration-500 ${isLive ? 'bg-[#3DDC84]' : 'bg-white'} ${answeringTeam ? 'scale-95 opacity-50' : 'scale-100'}`}>
              <h2 className="text-3xl font-black uppercase mb-4 opacity-50">Current Question</h2>
              <h1 className="text-6xl font-black leading-tight">
                {currentQuestion ? currentQuestion.text : 'Waiting for Organizer...'}
              </h1>
              <div className="mt-8 text-2xl font-bold uppercase tracking-widest bg-black text-white inline-block px-4 py-2">
                Status: {isLive ? 'LIVE' : 'LOCKED'}
              </div>
            </div>

            {/* Huge First Click Display */}
            {answeringTeam && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 p-8">
                <div className="w-full max-w-5xl bg-white border-8 border-black p-16 text-center animate-bounce shadow-[12px_12px_0px_0px_#000]">
                  <h2 className="text-4xl font-black uppercase mb-4 opacity-50">Buzz! We have a response from:</h2>
                  <h1 className="text-8xl font-black uppercase text-[#3DDC84] drop-shadow-md mb-8">{answeringTeam.teamName}</h1>
                  <div className="text-4xl font-bold bg-black text-white inline-block px-6 py-3 border-4 border-black">
                    +{answeringTeam.hitTime - leaderboard[0].hitTime}ms
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-500">
            {/* Live Reaction Leaderboard */}
            <div className="w-full border-8 border-black bg-white box-shadow-brutal p-8">
              <h2 className="text-4xl font-black uppercase mb-8 border-b-8 border-black pb-4">Live Reaction Times</h2>
              {leaderboard.length > 0 ? (
                <div className="space-y-4">
                  {leaderboard.map((entry, idx) => (
                    <div key={entry.teamCode} className={`flex items-center text-3xl font-bold border-4 border-black p-4 uppercase ${entry.isWrong ? 'bg-red-100 opacity-50 line-through' : 'bg-gray-50'}`}>
                      <span className="w-12 h-12 bg-black text-white flex items-center justify-center mr-4 border-4 border-black">
                        {idx + 1}
                      </span>
                      <span className="flex-1 drop-shadow-md text-black">{entry.teamName}</span>
                      <span className="bg-white border-4 border-black px-4 py-2 text-xl ml-4">
                        +{entry.hitTime - (leaderboard[0]?.hitTime || entry.hitTime)}ms
                      </span>
                      {entry.isWrong && <span className="ml-4 text-red-500 text-4xl">❌</span>}
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
                 <p className="text-xl font-bold opacity-50 italic">Scores are managed by the Organizer Dashboard</p>
                 {/* Optionally fetch and render the actual total scores here if needed */}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
