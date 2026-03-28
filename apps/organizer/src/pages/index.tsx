import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, Team, LeaderboardEntry } from '@syncstrike/shared-types';
import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function OrganizerApp() {
  const [passcode, setPasscode] = useState('');
  const [isAuth, setIsAuth] = useState(false);
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!isAuth) return;

    const fetchDB = async () => {
      const qSnap = await getDocs(collection(db, 'questions'));
      const qs = qSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Question);
      setQuestions(qs);

      const tSnap = await getDocs(collection(db, 'teams'));
      const ts = tSnap.docs.map(d => ({ ...d.data(), code: d.id }) as Team);
      setTeams(ts);
    };

    fetchDB();

    const socket = io(BACKEND_URL);
    socket.emit('join_room', { role: 'organizer' });

    socket.on('state_update', ({ isLive: newLive, currentQuestion: newQ }) => {
      setIsLive(newLive);
      if (newQ) setCurrentQuestion(newQ);
      if (newLive) setLeaderboard([]);
    });

    socket.on('leaderboard_update', ({ leaderboard }) => {
      setLeaderboard(leaderboard);
    });

    return () => { socket.disconnect(); };
  }, [isAuth]);

  const loadMockData = async () => {
    const res = await fetch(`${BACKEND_URL}/api/mock-data`, {
      method: 'POST',
      headers: { 'Authorization': passcode }
    });
    if (res.ok) {
      alert('Mock Data Loaded! Refreshing...');
      window.location.reload();
    } else {
      alert('Unauthorized or failed.');
    }
  };

  const toggleBuzzer = async (liveState: boolean, questionId?: string) => {
    if (!questionId && !currentQuestion) return;
    const qid = questionId || currentQuestion?.id;
    
    await fetch(`${BACKEND_URL}/api/buzzer/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': passcode },
      body: JSON.stringify({ questionId: qid, isLive: liveState })
    });
  };

  const awardPoints = async (teamCode: string, points: number) => {
    const res = await fetch(`${BACKEND_URL}/api/buzzer/award`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': passcode },
      body: JSON.stringify({ teamCode, pointsToAdd: points })
    });
    if (res.ok) alert(`Awarded ${points} points to ${teamCode}`);
  };

  if (!isAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white border-8 border-black box-shadow-brutal p-8 space-y-4 max-w-sm w-full">
          <h1 className="text-3xl font-black uppercase text-center">Organizer Login</h1>
          <input
            type="password"
            className="w-full border-4 border-black p-4 text-xl font-bold"
            placeholder="ADMIN PASSCODE"
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
          />
          <button
            onClick={() => setIsAuth(true)}
            className="w-full bg-[#3DDC84] py-4 border-4 border-black font-black uppercase box-shadow-brutal active:translate-y-1 active:translate-x-1 active:shadow-none"
          >
            Access Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Controls */}
      <div className="space-y-8">
        <div className="bg-white border-8 border-black box-shadow-brutal p-8">
          <h2 className="text-3xl font-black uppercase mb-4">Buzzer Control</h2>
          
          <div className="mb-8">
            <select
              className="w-full border-4 border-black p-4 text-xl font-bold uppercase cursor-pointer"
              onChange={(e) => {
                const q = questions.find(qu => qu.id === e.target.value);
                if (q) {
                  setCurrentQuestion(q);
                  toggleBuzzer(false, q.id); // auto lock when selecting new
                }
              }}
              value={currentQuestion?.id || ''}
            >
              <option value="" disabled>Select a Question</option>
              {questions.map(q => (
                <option key={q.id} value={q.id}>{q.text}</option>
              ))}
            </select>
          </div>

          <div className="flex space-x-4">
            <button
              disabled={!currentQuestion || isLive}
              onClick={() => toggleBuzzer(true)}
              className="flex-1 bg-[#3DDC84] text-black border-4 border-black py-6 text-2xl font-black uppercase box-shadow-brutal active:translate-y-1 active:translate-x-1 active:shadow-none disabled:opacity-50 disabled:translate-x-0 disabled:translate-y-0"
            >
              Set Live
            </button>
            <button
              disabled={!currentQuestion || !isLive}
              onClick={() => toggleBuzzer(false)}
              className="flex-1 bg-red-500 text-white border-4 border-black py-6 text-2xl font-black uppercase box-shadow-brutal active:translate-y-1 active:translate-x-1 active:shadow-none disabled:opacity-50 disabled:translate-x-0 disabled:translate-y-0"
            >
              Lock
            </button>
          </div>
        </div>

        {/* Action Panel */}
        <div className="bg-white border-8 border-black box-shadow-brutal p-8">
          <h2 className="text-3xl font-black uppercase mb-4">System Actions</h2>
          <button
            onClick={loadMockData}
            className="w-full bg-black text-white border-4 border-black py-4 font-bold uppercase box-shadow-brutal hover:bg-gray-800"
          >
            Load Mock Data (Danger)
          </button>
        </div>
      </div>

      {/* Leaderboards */}
      <div className="space-y-8">
        {isLive && leaderboard.length > 0 && (
          <div className="bg-white border-8 border-black box-shadow-brutal p-8">
            <h2 className="text-3xl font-black uppercase mb-4">Live Hits</h2>
            <div className="space-y-2">
              {leaderboard.map((lb, idx) => (
                <div key={lb.teamCode} className="flex justify-between items-center bg-gray-100 border-4 border-black p-4 font-bold uppercase">
                  <span>{idx + 1}. {lb.teamCode}</span>
                  <div className="flex items-center space-x-4">
                    <span className="text-[#3DDC84]">+{lb.hitTime - leaderboard[0].hitTime}ms</span>
                    <button
                      onClick={() => awardPoints(lb.teamCode, 10)}
                      className="bg-black text-white px-4 py-2 hover:bg-gray-800 border-2 border-black"
                    >
                      +10 Pts
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white border-8 border-black box-shadow-brutal p-8">
          <h2 className="text-3xl font-black uppercase mb-4">Total Accuracy Scoreboard</h2>
          <div className="space-y-2">
            {teams.sort((a,b) => b.totalScore - a.totalScore).map(t => (
              <div key={t.code} className="flex justify-between items-center bg-gray-100 border-4 border-black p-4 font-bold uppercase">
                <span>{t.code} - {t.name}</span>
                <span className="text-2xl">{t.totalScore}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
