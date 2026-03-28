import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, Team, LeaderboardEntry } from '@syncstrike/shared-types';
import { io, Socket } from 'socket.io-client';
import Papa from 'papaparse';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function OrganizerApp() {
  const [passcode, setPasscode] = useState('');
  const [isAuth, setIsAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<'live' | 'teams' | 'questions'>('live');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answeringTeam, setAnsweringTeam] = useState<LeaderboardEntry | null>(null);
  const [endTime, setEndTime] = useState<number | undefined>(undefined);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // File upload states
  const [uploadMode, setUploadMode] = useState<'append' | 'replace'>('append');

  useEffect(() => {
    const savedPass = localStorage.getItem('admin_pass');
    if (savedPass) {
      setPasscode(savedPass);
      setIsAuth(true);
    }
  }, []);

  const fetchData = async () => {
    const qSnap = await getDocs(collection(db, 'questions'));
    const qs = qSnap.docs.map(d => ({ ...d.data(), id: d.id }) as Question);
    setQuestions(qs);

    const tSnap = await getDocs(collection(db, 'teams'));
    const ts = tSnap.docs.map(d => ({ ...d.data(), code: d.id }) as Team);
    setTeams(ts);
  };

  useEffect(() => {
    if (!isAuth) return;

    fetchData();
    const socket = io(BACKEND_URL);
    socket.emit('join_room', { role: 'organizer' });

    socket.on('state_update', ({ isLive: newLive, currentQuestion: newQ, endTime: newEndTime }) => {
      setIsLive(newLive);
      setEndTime(newEndTime);
      if (newQ) setCurrentQuestion(newQ);
      if (newLive) {
        setLeaderboard([]);
        setAnsweringTeam(null);
      }
    });

    socket.on('leaderboard_update', ({ leaderboard }) => {
      setLeaderboard(leaderboard);
    });

    socket.on('answering_team', ({ team }) => {
      setAnsweringTeam(team);
    });

    return () => { socket.disconnect(); };
  }, [isAuth]);

  useEffect(() => {
    if (isLive && endTime) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isLive, endTime]);

  const handleLogin = () => {
    if (passcode.length > 0) {
      localStorage.setItem('admin_pass', passcode);
      setIsAuth(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_pass');
    setIsAuth(false);
    setPasscode('');
  };

  const apiCall = async (path: string, method: string, body?: any) => {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': passcode },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      if (res.status === 401) {
        alert('Unauthorized - Incorrect Passcode');
        handleLogout();
      } else {
        alert('Action failed.');
      }
    }
    return res;
  };

  const loadMockData = async () => {
    if (!confirm('Warning: This will clear existing data. Proceed?')) return;
    await apiCall('/api/mock-data', 'POST');
    fetchData();
  };

  const clearDatabase = async () => {
    if (!confirm('DANGER: This will permanently delete ALL teams and questions. Proceed?')) return;
    await apiCall('/api/db/clear', 'POST');
    fetchData();
  };

  const toggleBuzzer = async (liveState: boolean, questionId?: string) => {
    const qid = questionId || currentQuestion?.id;
    if (!qid) return;
    await apiCall('/api/buzzer/toggle', 'POST', { questionId: qid, isLive: liveState });
  };

  const handleCorrect = async () => {
    if (!answeringTeam || !currentQuestion) return;
    await apiCall('/api/buzzer/correct', 'POST', { teamCode: answeringTeam.teamCode, questionId: currentQuestion.id });
    fetchData(); // Refresh scores
  };

  const handleWrong = async () => {
    if (!answeringTeam || !currentQuestion) return;
    await apiCall('/api/buzzer/wrong', 'POST', { teamCode: answeringTeam.teamCode, questionId: currentQuestion.id });
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>, type: 'teams' | 'questions') => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const res = await apiCall('/api/bulk', 'POST', { type, mode: uploadMode, data: results.data });
        if (res.ok) {
          alert(`Successfully uploaded ${type}.`);
          fetchData();
        }
      }
    });
  };

  const deleteTeam = async (code: string) => {
    if (confirm(`Delete team ${code}?`)) {
      await apiCall(`/api/teams/${code}`, 'DELETE');
      fetchData();
    }
  };

  const deleteQuestion = async (id: string) => {
    if (confirm(`Delete question ${id}?`)) {
      await apiCall(`/api/questions/${id}`, 'DELETE');
      fetchData();
    }
  };

  if (!isAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white border-8 border-black box-shadow-brutal p-8 space-y-4 max-w-sm w-full">
          <h1 className="text-3xl font-black uppercase text-center">Organizer Login</h1>
          <input type="password"
            className="w-full border-4 border-black p-4 text-xl font-bold"
            placeholder="ADMIN PASSCODE" value={passcode} onChange={e => setPasscode(e.target.value)} />
          <button onClick={handleLogin} className="w-full bg-[#3DDC84] py-4 border-4 border-black font-black uppercase box-shadow-brutal active:translate-y-1 active:translate-x-1 active:shadow-none">
            Access Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      {/* Top Nav */}
      <div className="flex justify-between items-center bg-white border-4 border-black box-shadow-brutal p-4 mb-8">
        <div className="flex space-x-4">
          <button onClick={() => setActiveTab('live')} className={`px-6 py-2 font-black border-4 border-black uppercase ${activeTab === 'live' ? 'bg-[#3DDC84]' : 'bg-gray-200'}`}>Live Control</button>
          <button onClick={() => setActiveTab('teams')} className={`px-6 py-2 font-black border-4 border-black uppercase ${activeTab === 'teams' ? 'bg-blue-400' : 'bg-gray-200'}`}>Teams</button>
          <button onClick={() => setActiveTab('questions')} className={`px-6 py-2 font-black border-4 border-black uppercase ${activeTab === 'questions' ? 'bg-yellow-400' : 'bg-gray-200'}`}>Questions</button>
        </div>
        <button onClick={handleLogout} className="px-6 py-2 bg-red-500 text-white font-black border-4 border-black uppercase">Logout</button>
      </div>

      {activeTab === 'live' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-8">
            <div className="bg-white border-8 border-black box-shadow-brutal p-8 relative overflow-hidden">
              {/* Countdown Progress Bar */}
              {isLive && endTime && (
                <div className="absolute top-0 left-0 h-2 bg-[#3DDC84] transition-all duration-100" style={{ width: `${(timeLeft / 10) * 100}%` }}></div>
              )}
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-3xl font-black uppercase">Buzzer Control</h2>
                {isLive && <span className="font-black text-xl">{timeLeft}s remaining</span>}
              </div>
              <select className="w-full border-4 border-black p-4 text-xl font-bold uppercase cursor-pointer mb-8"
                onChange={(e) => {
                  const q = questions.find(qu => qu.id === e.target.value);
                  if (q) { setCurrentQuestion(q); toggleBuzzer(false, q.id); }
                }}
                value={currentQuestion?.id || ''}
              >
                <option value="" disabled>Select a Question</option>
                {questions.map(q => <option key={q.id} value={q.id}>{q.text}</option>)}
              </select>

              <div className="flex space-x-4">
                <button disabled={!currentQuestion || isLive} onClick={() => toggleBuzzer(true)} className="flex-1 bg-[#3DDC84] border-4 border-black py-6 text-2xl font-black uppercase box-shadow-brutal active:translate-y-1 active:shadow-none disabled:opacity-50">Set Live (10s)</button>
                <button disabled={!currentQuestion || !isLive} onClick={() => toggleBuzzer(false)} className="flex-1 bg-red-500 text-white border-4 border-black py-6 text-2xl font-black uppercase box-shadow-brutal active:translate-y-1 active:shadow-none disabled:opacity-50">Lock</button>
              </div>
            </div>

            {/* ACTION PANEL */}
            {isLive && answeringTeam && (
              <div className="bg-white border-8 border-black box-shadow-brutal p-8 text-center animate-pulse">
                <h3 className="text-2xl font-bold uppercase mb-2">Answering Team:</h3>
                <h1 className="text-5xl font-black uppercase text-[#3DDC84] bg-black inline-block px-4 py-2 mb-8">{answeringTeam.teamName}</h1>
                <div className="flex space-x-4">
                  <button onClick={handleCorrect} className="flex-1 bg-[#3DDC84] border-4 border-black py-4 text-2xl font-black uppercase">✅ Correct (+1)</button>
                  <button onClick={handleWrong} className="flex-1 bg-red-500 text-white border-4 border-black py-4 text-2xl font-black uppercase">❌ Wrong</button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div className="bg-white border-8 border-black box-shadow-brutal p-8">
              <h2 className="text-3xl font-black uppercase mb-4">Live Reaction Times</h2>
              {leaderboard.length === 0 ? <p className="opacity-50 italic">Waiting for buzzes...</p> : (
                <div className="space-y-2">
                  {leaderboard.map(lb => (
                    <div key={lb.teamCode} className={`flex justify-between items-center border-4 border-black p-4 font-bold uppercase ${lb.isWrong ? 'bg-red-100 line-through opacity-50' : 'bg-gray-100'}`}>
                      <span>{lb.rank}. {lb.teamName} ({lb.teamCode})</span>
                      <span className="text-[#3DDC84] bg-black px-2">{lb.hitTime - leaderboard[0].hitTime}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border-8 border-black box-shadow-brutal p-8">
              <h2 className="text-3xl font-black uppercase mb-4">Total Scoreboard</h2>
              <div className="space-y-2">
                {[...teams].sort((a,b) => b.totalScore - a.totalScore).map(t => (
                  <div key={t.code} className="flex justify-between border-4 border-black p-4 font-bold uppercase bg-gray-100">
                    <span>{t.name}</span><span className="text-2xl">{t.totalScore}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border-8 border-black box-shadow-brutal p-8 border-red-500">
              <h2 className="text-3xl font-black uppercase text-red-500 mb-4">Danger Zone</h2>
              <button onClick={loadMockData} className="w-full bg-black text-white border-4 border-black py-4 font-bold uppercase mb-4">Load Mock Data</button>
              <button onClick={clearDatabase} className="w-full bg-red-500 text-white border-4 border-black py-4 font-bold uppercase">Clear Entire Database</button>
            </div>
          </div>
        </div>
      )}

      {/* TEAMS TAB */}
      {activeTab === 'teams' && (
        <div className="bg-white border-8 border-black box-shadow-brutal p-8">
           <h2 className="text-4xl font-black uppercase mb-8">Manage Teams</h2>
           <div className="flex items-center space-x-4 mb-8 bg-gray-100 p-4 border-4 border-black">
              <div className="font-bold uppercase">CSV Upload:</div>
              <input type="file" accept=".csv" onChange={(e) => handleCsvUpload(e, 'teams')} />
              <select className="border-2 border-black p-2 font-bold uppercase" value={uploadMode} onChange={(e) => setUploadMode(e.target.value as any)}>
                <option value="append">Append (Merge)</option>
                <option value="replace">Replace (Wipe Existing)</option>
              </select>
              <div className="text-sm opacity-50 ml-4">(Format: code, name)</div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {teams.map(t => (
                <div key={t.code} className="flex justify-between items-center border-4 border-black p-4 bg-gray-50">
                   <div>
                      <div className="font-black text-xl uppercase">{t.name}</div>
                      <div className="font-bold opacity-50">Code: {t.code} | Score: {t.totalScore}</div>
                   </div>
                   <button onClick={() => deleteTeam(t.code)} className="bg-red-500 text-white p-2 font-bold border-2 border-black">Delete</button>
                </div>
              ))}
           </div>
        </div>
      )}

      {/* QUESTIONS TAB */}
      {activeTab === 'questions' && (
        <div className="bg-white border-8 border-black box-shadow-brutal p-8">
           <h2 className="text-4xl font-black uppercase mb-8">Manage Questions</h2>
           <div className="flex items-center space-x-4 mb-8 bg-gray-100 p-4 border-4 border-black">
              <div className="font-bold uppercase">CSV Upload:</div>
              <input type="file" accept=".csv" onChange={(e) => handleCsvUpload(e, 'questions')} />
              <select className="border-2 border-black p-2 font-bold uppercase" value={uploadMode} onChange={(e) => setUploadMode(e.target.value as any)}>
                <option value="append">Append (Merge)</option>
                <option value="replace">Replace (Wipe Existing)</option>
              </select>
              <div className="text-sm opacity-50 ml-4">(Format: id, text, answer)</div>
           </div>
           <div className="space-y-4">
              {questions.map(q => (
                <div key={q.id} className="flex justify-between items-center border-4 border-black p-4 bg-gray-50">
                   <div>
                      <div className="font-bold opacity-50 uppercase">ID: {q.id}</div>
                      <div className="font-black text-2xl">{q.text}</div>
                      <div className="font-bold text-[#3DDC84] mt-2">Answer: {q.answer}</div>
                   </div>
                   <button onClick={() => deleteQuestion(q.id)} className="bg-red-500 text-white p-2 font-bold border-2 border-black">Delete</button>
                </div>
              ))}
           </div>
        </div>
      )}
    </div>
  );
}
