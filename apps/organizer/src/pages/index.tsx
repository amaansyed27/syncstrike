import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Question, Team, LeaderboardEntry, GameState } from '@syncstrike/shared-types';
import { io, Socket } from 'socket.io-client';
import Papa from 'papaparse';
import Lottie from 'lottie-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export default function OrganizerApp() {
  const [passcode, setPasscode] = useState('');
  const [isAuth, setIsAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'leaderboards' | 'teams' | 'questions' | 'settings'>('home');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answeringTeam, setAnsweringTeam] = useState<LeaderboardEntry | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const [uploadMode, setUploadMode] = useState<'append' | 'replace'>('append');
  const [showRemote, setShowRemote] = useState(false);
  const [androidLottie, setAndroidLottie] = useState<object | null>(null);

  const verifyAuth = async (pass: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/verify-passcode`, {
        method: 'POST',
        headers: { 'Authorization': pass }
      });
      if (res.ok) {
        setPasscode(pass);
        setIsAuth(true);
        localStorage.setItem('admin_pass', pass);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const savedPass = localStorage.getItem('admin_pass');
    if (savedPass) verifyAuth(savedPass);
  }, []);

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
  }, [isAuth]);

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

  const handleLogin = async () => {
    if (passcode.length > 0) {
      const valid = await verifyAuth(passcode);
      if (!valid) alert('Invalid Passcode');
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
        alert('Unauthorized - Session Expired');
        handleLogout();
      } else {
        const err = await res.json();
        alert(`Action failed: ${err.error || res.statusText}`);
      }
    }
    return res;
  };

  // ACTIONS
  const startLive = async () => await apiCall('/api/buzzer/start', 'POST');
  const stopLive = async () => await apiCall('/api/buzzer/stop', 'POST');
  const skipQuestion = async () => await apiCall('/api/buzzer/skip', 'POST');
  const reopenLive = async () => await apiCall('/api/buzzer/reopen', 'POST');

  const handleCorrect = async () => {
    if (!answeringTeam) return;
    await apiCall('/api/buzzer/correct', 'POST', { teamCode: answeringTeam.teamCode, teamName: answeringTeam.teamName });
    fetchData(); // Refresh to show completed question
  };

  const handleWrong = async () => {
    if (!answeringTeam) return;
    await apiCall('/api/buzzer/wrong', 'POST', { teamCode: answeringTeam.teamCode });
  };

  const setProjectorView = async (view: 'home' | 'reaction' | 'accuracy') => {
    await apiCall('/api/projector/view', 'POST', { view });
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

  if (!isAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-8 space-y-4 max-w-sm w-full">
          <div className="flex items-center justify-center gap-3">
            <img
              src="/assets/svg-static/pixel-android.svg"
              alt="Android Club Icon"
              className="w-9 h-9 object-contain"
            />
            <h1 className="text-3xl font-black uppercase text-center">Organizer Login</h1>
          </div>
          <p className="text-center text-xs font-bold uppercase tracking-widest opacity-60">Android Club • GeekRush</p>
          {androidLottie && (
            <div className="w-24 h-24 mx-auto border-2 border-black bg-white">
              <Lottie animationData={androidLottie} loop autoplay />
            </div>
          )}
          <input type="password"
            className="w-full border-4 border-black p-4 text-xl font-bold focus:outline-none"
            placeholder="PASSCODE" value={passcode} onChange={e => setPasscode(e.target.value)} />
          <button onClick={handleLogin} className="w-full bg-[#3DDC84] py-4 border-4 border-black font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
            Access Dashboard
          </button>
          <img
            src="/assets/svg-animated/syncstrike-andy-button.svg"
            alt="SyncStrike Andy"
            className="w-full h-24 object-contain border-2 border-black bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans pb-12">
      
      {/* Remote Control Expander (Hover to open) */}
      <div 
        className="fixed top-[100px] right-0 z-50 transition-transform duration-300 transform translate-x-[280px] hover:translate-x-0"
      >
        <div className="flex items-center">
          <div className="bg-black text-white px-2 py-4 border-y-4 border-l-4 border-black font-bold uppercase" style={{ writingMode: 'vertical-rl' }}>
            Remote Control
          </div>
          <div className="bg-white border-4 border-black shadow-[-8px_8px_0px_0px_#000] p-4 w-[280px] space-y-4">
            <h3 className="font-black uppercase text-center border-b-2 border-black pb-2">Projector Screen</h3>
            <button onClick={() => setProjectorView('home')} className={`w-full border-2 border-black py-2 font-bold uppercase transition-all shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none ${gameState?.projectorView === 'home' ? 'bg-[#3DDC84]' : 'bg-gray-100 hover:bg-gray-200'}`}>1. Spotlight (Live)</button>
            <button onClick={() => setProjectorView('reaction')} className={`w-full border-2 border-black py-2 font-bold uppercase transition-all shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none ${gameState?.projectorView === 'reaction' ? 'bg-[#3DDC84]' : 'bg-gray-100 hover:bg-gray-200'}`}>2. Reaction Queue</button>
            <button onClick={() => setProjectorView('accuracy')} className={`w-full border-2 border-black py-2 font-bold uppercase transition-all shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none ${gameState?.projectorView === 'accuracy' ? 'bg-[#3DDC84]' : 'bg-gray-100 hover:bg-gray-200'}`}>3. Total Scoreboard</button>
          </div>
        </div>
      </div>

      {/* Sticky Top Navbar */}
      <div className="sticky top-0 z-40 bg-white border-b-4 border-black shadow-[0px_4px_0px_0px_#000] p-4 px-8 flex flex-col md:flex-row justify-between items-center mb-8 gap-4 md:gap-0">
        <div className="flex items-center gap-3">
          <img
            src="/assets/svg-static/pixel-android.svg"
            alt="Android Club Icon"
            className="w-9 h-9 object-contain"
          />
          <h1 className="text-2xl font-black uppercase tracking-tighter">SyncStrike</h1>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {['home', 'leaderboards', 'teams', 'questions', 'settings'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-4 py-2 font-bold border-2 border-black uppercase text-sm shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all ${activeTab === tab ? 'bg-black text-[#3DDC84]' : 'bg-white hover:bg-gray-100'}`}>
              {tab === 'leaderboards' ? 'Scoreboard' : tab}
            </button>
          ))}
          <button onClick={handleLogout} className="ml-2 px-4 py-2 bg-red-500 text-white font-bold border-2 border-black uppercase text-sm shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">Sign Out</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4">
        {/* HOME TAB (LIVE CONTROL) */}
        {activeTab === 'home' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6 relative overflow-hidden flex flex-col h-[500px]">
              {gameState?.buzzerState === 'LIVE' && gameState?.endTime && (
                <div className="absolute top-0 left-0 h-2 bg-[#3DDC84] transition-all duration-100" style={{ width: `${(timeLeft / 10) * 100}%` }}></div>
              )}
              <div className="flex justify-between items-center mb-4 border-b-4 border-black pb-4">
                <h2 className="text-2xl font-black uppercase">Live Control</h2>
                <div className={`px-4 py-1 text-sm font-bold uppercase border-2 border-black text-white ${gameState?.buzzerState === 'LIVE' ? 'bg-black' : gameState?.buzzerState === 'JUDGING' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                  {gameState?.buzzerState} {gameState?.buzzerState === 'LIVE' ? `(${timeLeft}s)` : ''}
                </div>
              </div>

              {/* Current Question Card */}
              {gameState?.activeQuestion ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                  <span className="text-xs font-bold opacity-50 uppercase tracking-widest mb-2">Active Question (ID: {gameState.activeQuestion.id})</span>
                  <h3 className="text-3xl font-black leading-tight mb-4">{gameState.activeQuestion.text}</h3>
                  <div className="text-[#3DDC84] bg-black px-4 py-2 font-bold text-lg border-2 border-black">Answer: {gameState.activeQuestion.answer}</div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                  <p className="font-bold text-xl uppercase mb-4">No Question Active</p>
                  <p className="text-sm">Click "Fetch Random Question" to begin.</p>
                </div>
              )}

              {/* Controls */}
              <div className="mt-auto border-t-4 border-black pt-4">
                {gameState?.buzzerState === 'LOCKED' && (
                  <button onClick={startLive} className="w-full bg-[#3DDC84] border-4 border-black py-4 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                    Fetch Random & Go Live (10s)
                  </button>
                )}
                {gameState?.buzzerState === 'LIVE' && (
                  <button onClick={stopLive} className="w-full bg-yellow-400 border-4 border-black py-4 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                    Stop Timer & Start Judging
                  </button>
                )}
                {gameState?.buzzerState === 'JUDGING' && !answeringTeam && (
                  <div className="flex space-x-4">
                    <button onClick={reopenLive} className="flex-1 bg-yellow-400 border-4 border-black py-4 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                      Reopen (10s)
                    </button>
                    <button onClick={skipQuestion} className="flex-1 bg-red-500 text-white border-4 border-black py-4 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                      Skip Question
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Judging Panel */}
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6 h-[500px] flex flex-col">
              <h2 className="text-2xl font-black uppercase mb-4 border-b-4 border-black pb-4">Judging Desk</h2>
              
              {gameState?.buzzerState === 'JUDGING' && answeringTeam ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in">
                  <h3 className="text-sm font-bold uppercase opacity-50 mb-2">First Valid Response</h3>
                  <h1 className="text-4xl font-black uppercase text-[#3DDC84] bg-black px-6 py-4 border-4 border-black mb-8">{answeringTeam.teamName}</h1>
                  <div className="flex w-full space-x-4">
                    <button onClick={handleCorrect} className="flex-1 bg-[#3DDC84] border-4 border-black py-6 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">✅ Correct (+1)</button>
                    <button onClick={handleWrong} className="flex-1 bg-red-500 text-white border-4 border-black py-6 text-xl font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">❌ Wrong</button>
                  </div>
                </div>
              ) : gameState?.buzzerState === 'JUDGING' && !answeringTeam ? (
                <div className="flex-1 flex items-center justify-center font-bold text-xl uppercase opacity-50 text-center">Queue Empty<br/>No more valid responses</div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-20"><span className="text-6xl">⏳</span></div>
              )}

              {/* Mini-Queue preview */}
              {leaderboard.length > 1 && gameState?.buzzerState === 'JUDGING' && (
                <div className="mt-auto border-t-4 border-black pt-4">
                  <div className="text-xs font-bold uppercase opacity-50 mb-2">Up Next:</div>
                  <div className="flex space-x-2 overflow-x-auto pb-2">
                    {leaderboard.filter(lb => !lb.isWrong && lb.teamCode !== answeringTeam?.teamCode).map(lb => (
                      <div key={lb.teamCode} className="whitespace-nowrap px-3 py-1 border-2 border-black bg-gray-100 font-bold text-xs uppercase">{lb.teamName}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LEADERBOARDS TAB */}
        {activeTab === 'leaderboards' && (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6 max-w-4xl mx-auto">
            <h2 className="text-3xl font-black uppercase mb-6 border-b-4 border-black pb-4">Accuracy Scoreboard</h2>
            <div className="space-y-3">
              {[...teams].sort((a,b) => b.totalScore - a.totalScore).map((t, idx) => (
                <div key={t.code} className="flex justify-between items-center text-xl font-bold border-4 border-black p-4 uppercase bg-gray-50 shadow-[4px_4px_0px_0px_#000]">
                  <div className="flex items-center">
         
           <span className="opacity-50 mr-4">#{idx + 1}</span>
                    <span>{t.name}</span>
                  </div>
                  <span className="border-2 border-black px-4 py-1 bg-[#3DDC84] text-black">
                    {t.totalScore}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TEAMS */}
        {activeTab === 'teams' && (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6">
            <h2 className="text-2xl font-black uppercase mb-6 border-b-4 border-black pb-4">Manage Teams</h2>
            <div className="flex flex-col md:flex-row items-center gap-4 mb-8 bg-gray-100 p-4 border-4 border-black">
               <div className="font-bold uppercase whitespace-nowrap">CSV Upload:</div>
               <input type="file" accept=".csv" onChange={(e) => handleCsvUpload(e, 'teams')} className="w-full md:flex-1" />
               <select className="border-2 border-black p-2 font-bold uppercase w-full md:w-auto" value={uploadMode} onChange={(e) => setUploadMode(e.target.value as any)}>
                 <option value="append">Append</option>
                 <option value="replace">Replace</option>
               </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
               {teams.map(t => (
                 <div key={t.code} className="flex justify-between items-center border-2 border-black p-4 bg-gray-50 shadow-[2px_2px_0px_0px_#000]">
                    <div>
                       <div className="font-black uppercase">{t.name}</div>
                       <div className="text-xs font-bold opacity-50">Code: {t.code} | Score: {t.totalScore}</div>
                    </div>
                    <button onClick={async () => { if(confirm('Delete?')) { await apiCall(`/api/teams/${encodeURIComponent(t.code)}`, 'DELETE'); fetchData(); } }} className="bg-red-500 text-white px-3 py-1 font-bold border-2 border-black text-sm shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">Delete</button>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* QUESTIONS */}
        {activeTab === 'questions' && (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6">
            <h2 className="text-2xl font-black uppercase mb-6 border-b-4 border-black pb-4">Manage Questions</h2>
            <div className="flex flex-col md:flex-row items-center gap-4 mb-8 bg-gray-100 p-4 border-4 border-black">
               <div className="font-bold uppercase whitespace-nowrap">CSV Upload:</div>
               <input type="file" accept=".csv" onChange={(e) => handleCsvUpload(e, 'questions')} className="w-full md:flex-1" />
               <select className="border-2 border-black p-2 font-bold uppercase w-full md:w-auto" value={uploadMode} onChange={(e) => setUploadMode(e.target.value as any)}>
                 <option value="append">Append</option>
                 <option value="replace">Replace</option>
               </select>
            </div>
            <div className="space-y-4">
               {[...questions].sort((a, b) => {
                 const weightA = a.isComplete ? 1 : a.isSkipped ? 2 : 0;
                 const weightB = b.isComplete ? 1 : b.isSkipped ? 2 : 0;
                 return weightA - weightB;
               }).map(q => (
                 <div key={q.id} className={`flex justify-between items-center border-4 border-black p-4 shadow-[4px_4px_0px_0px_#000] ${q.isComplete ? 'bg-[#3DDC84]/20' : q.isSkipped ? 'bg-gray-300' : 'bg-gray-50'}`}>
                    <div>
                       <div className="flex items-center gap-2 mb-1">
                         <div className="text-xs font-bold opacity-50 uppercase">ID: {q.id} {q.isComplete && `| WINNER: ${q.winnerName || q.winnerCode}`}</div>
                         {q.isComplete && <span className="bg-[#3DDC84] text-black px-2 py-0.5 text-[10px] font-black border-2 border-black uppercase">Completed</span>}
                         {q.isSkipped && !q.isComplete && <span className="bg-gray-500 text-white px-2 py-0.5 text-[10px] font-black border-2 border-black uppercase">Skipped</span>}
                       </div>
                       <div className="font-black text-xl">{q.text}</div>
                       <div className="text-sm font-bold text-gray-600 mt-1">Ans: {q.answer}</div>
                    </div>
                    <button onClick={async () => { if(confirm('Delete?')) { await apiCall(`/api/questions/${encodeURIComponent(q.id)}`, 'DELETE'); fetchData(); } }} className="bg-red-500 text-white px-4 py-2 font-bold border-2 border-black text-sm shadow-[2px_2px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none">Delete</button>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {activeTab === 'settings' && (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] p-6 max-w-2xl mx-auto space-y-8">
            
            <div>
              <h2 className="text-2xl font-black uppercase mb-4 border-b-4 border-black pb-4">Game Management</h2>
              <button onClick={async () => { if(confirm('This resets all team points to 0 and reopens all questions. Keep existing teams and questions?')) { await apiCall('/api/db/reset-game', 'POST'); fetchData(); alert('Game Reset!'); } }} className="w-full bg-yellow-400 text-black border-4 border-black py-4 font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                Reset Game (Scores & Questions)
              </button>
            </div>

            <div>
              <h2 className="text-2xl font-black uppercase mb-4 border-b-4 border-black pb-4">Mock Data</h2>
              <button onClick={async () => { if(confirm('Wipe and Load Mock Data?')) { await apiCall('/api/mock-data', 'POST'); fetchData(); } }} className="w-full bg-black text-white border-4 border-black py-4 font-black uppercase shadow-[4px_4px_0px_0px_#000] hover:bg-gray-800 active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                Load Mock Data
              </button>
            </div>

            <div>
              <h2 className="text-2xl font-black uppercase text-red-500 mb-4 border-b-4 border-red-500 pb-4">Danger Zone</h2>
              <button onClick={async () => { if(confirm('DELETE EVERYTHING? (Teams & Questions)')) { await apiCall('/api/db/clear', 'POST'); fetchData(); } }} className="w-full bg-red-500 text-white border-4 border-black py-4 font-black uppercase shadow-[4px_4px_0px_0px_#000] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all">
                Clear Entire Database
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
