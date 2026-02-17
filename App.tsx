import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Schedule, Subject, DayOfWeek, StudySession, ChatMessage, TimerState } from './types';
import { SUBJECTS, DAYS, SUBJECT_INFO } from './constants';
import { getTutorResponse, speakText, playNotificationSound } from './services/geminiService';
import { 
  Plus, Calendar, MessageSquare, Trash2, 
  ChevronLeft, LayoutDashboard, Clock, 
  Settings, Bell, Play, CheckCircle, 
  ChevronRight, BrainCircuit, Volume2, Pause, RotateCcw,
  Zap, BookOpen, X, BellOff, Info, Share
} from 'lucide-react';

const STORAGE_KEY = 'med_quest_v5_schedules';
const ACTIVE_ID_KEY = 'med_quest_v5_active_id';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>(View.MENU);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [showIosGuide, setShowIosGuide] = useState(false);
  
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_ID_KEY);
  });

  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [chatHistory, setChatHistory] = useState<Record<Subject, ChatMessage[]>>(() => {
    const initial: any = {};
    SUBJECTS.forEach(s => initial[s] = []);
    return initial;
  });
  
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'start' | 'end' | 'success' | 'error'} | null>(null);
  const [lastNotified, setLastNotified] = useState<{id: string, time: string} | null>(null);

  const [timer, setTimer] = useState<TimerState>({ isActive: false, timeLeft: 25 * 60, mode: 'study' });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    if (activeScheduleId) {
      localStorage.setItem(ACTIVE_ID_KEY, activeScheduleId);
    } else {
      localStorage.removeItem(ACTIVE_ID_KEY);
    }
  }, [activeScheduleId]);

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isStandalone) {
      setTimeout(() => setShowIosGuide(true), 2000);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      if (navigator.vibrate) navigator.vibrate(50);
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        triggerNotification("Notifications enabled!", "success");
      }
    }
  };

  useEffect(() => {
    let interval: any;
    if (timer.isActive && timer.timeLeft > 0) {
      interval = setInterval(() => {
        setTimer(t => ({ ...t, timeLeft: t.timeLeft - 1 }));
      }, 1000);
    } else if (timer.timeLeft === 0) {
      const msg = timer.mode === 'study' ? "Time for a break!" : "Break over! Let's study.";
      triggerNotification(msg, 'end', true);
      setTimer({
        isActive: false,
        mode: timer.mode === 'study' ? 'break' : 'study',
        timeLeft: timer.mode === 'study' ? 5 * 60 : 25 * 60
      });
    }
    return () => clearInterval(interval);
  }, [timer.isActive, timer.timeLeft]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const currentDay = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
      const currentTimeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      schedules.forEach(schedule => {
        schedule.sessions.forEach(session => {
          if (session.day === currentDay) {
            const startId = `${session.id}-start`;
            const endId = `${session.id}-end`;
            if (session.startTime === currentTimeStr && lastNotified?.id !== startId) {
              triggerNotification(`START: ${session.subject} session!`, 'start', true);
              setLastNotified({ id: startId, time: currentTimeStr });
            } else if (session.endTime === currentTimeStr && lastNotified?.id !== endId) {
              triggerNotification(`FINISH: ${session.subject} session!`, 'end', true);
              setLastNotified({ id: endId, time: currentTimeStr });
            }
          }
        });
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [schedules, lastNotified]);

  const triggerNotification = (msg: string, type: 'start' | 'end' | 'success' | 'error', system: boolean = false) => {
    setNotification({ message: msg, type });
    if (system) {
      playNotificationSound();
      if (notificationPermission === 'granted') {
        try { new Notification("MedQuest Assistant", { body: msg, icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png' }); } catch (e) {}
      }
    }
    setTimeout(() => setNotification(null), 5000);
  };

  const handleCreateSchedule = () => {
    if (!newScheduleName.trim()) return;
    const newSchedule: Schedule = { id: `plan-${Date.now()}`, name: newScheduleName.trim(), sessions: [], createdAt: Date.now() };
    setSchedules(prev => [...prev, newSchedule]);
    setActiveScheduleId(newSchedule.id);
    setNewScheduleName('');
    setIsCreatingSchedule(false);
    setCurrentView(View.EDITOR);
    triggerNotification(`Protocol "${newSchedule.name}" initiated`, 'success');
  };

  const handleSendMessage = async (subject: Subject, text: string) => {
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    setChatHistory(prev => ({ ...prev, [subject]: [...prev[subject], userMsg] }));
    setIsTyping(true);
    const responseText = await getTutorResponse(subject, text, chatHistory[subject]);
    setIsTyping(false);
    if (responseText) {
      const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', content: responseText, timestamp: Date.now() };
      setChatHistory(prev => ({ ...prev, [subject]: [...prev[subject], modelMsg] }));
      if (isVoiceEnabled) await speakText(responseText);
    }
  };

  const addSessionToActive = (session: Omit<StudySession, 'id'>) => {
    if (!activeScheduleId) return;
    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, sessions: [...s.sessions, { ...session, id: `session-${Math.random().toString(36).substr(2, 9)}` }] } : s));
    triggerNotification(`${session.subject} session added`, 'success');
  };

  const removeSessionFromActive = (sessionId: string) => {
    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, sessions: s.sessions.filter(sess => sess.id !== sessionId) } : s));
  };

  const activeSchedule = useMemo(() => schedules.find(s => s.id === activeScheduleId), [schedules, activeScheduleId]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden font-inter select-none">
      <header className="h-12 bg-white/90 backdrop-blur-lg border-b px-4 flex items-center justify-between z-50 shrink-0 shadow-sm safe-top">
        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setCurrentView(View.MENU)}>
          <div className="bg-blue-600 p-1 rounded-lg group-hover:scale-105 transition-transform">
            <BrainCircuit className="text-white" size={16} />
          </div>
          <h1 className="text-sm font-black tracking-tight hidden sm:block">MedQuest AI</h1>
        </div>
        <nav className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <NavButton icon={<LayoutDashboard size={14}/>} active={currentView === View.DASHBOARD} onClick={() => activeSchedule ? setCurrentView(View.DASHBOARD) : setCurrentView(View.MENU)} />
          <NavButton icon={<Calendar size={14}/>} active={currentView === View.EDITOR} onClick={() => activeSchedule ? setCurrentView(View.EDITOR) : setCurrentView(View.MENU)} />
          <NavButton icon={<MessageSquare size={14}/>} active={currentView === View.AI_TUTOR} onClick={() => setCurrentView(View.AI_TUTOR)} />
        </nav>
        <div className="flex items-center gap-0.5">
           <button onClick={requestNotificationPermission} className={`p-1.5 rounded-md transition-all ${notificationPermission === 'granted' ? 'text-emerald-500 bg-emerald-50' : 'text-slate-400'}`}>
            {notificationPermission === 'granted' ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
           <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-1.5 rounded-md transition-all ${isVoiceEnabled ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}>
            <Volume2 size={16} />
          </button>
        </div>
      </header>

      {notification && (
        <div className="fixed top-14 right-4 left-4 sm:left-auto z-[100] p-3 rounded-xl shadow-lg border-l-2 bg-slate-900 text-white animate-in slide-in-from-top-2 duration-300 sm:min-w-[240px]">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-blue-400" />
            <p className="font-bold text-[10px] flex-1">{notification.message}</p>
            <button onClick={() => setNotification(null)} className="opacity-40"><X size={12}/></button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto custom-scrollbar relative">
        {currentView === View.MENU && (
          <MenuView schedules={schedules} activeId={activeScheduleId} onSelect={(id) => { setActiveScheduleId(id); setCurrentView(View.DASHBOARD); }} isCreating={isCreatingSchedule} setIsCreating={setIsCreatingSchedule} newName={newScheduleName} setNewName={setNewScheduleName} onCreate={handleCreateSchedule} onDelete={(id) => { if (confirm("Delete this plan?")) { setSchedules(prev => prev.filter(s => s.id !== id)); if (activeScheduleId === id) setActiveScheduleId(null); } }} />
        )}
        {currentView === View.DASHBOARD && activeSchedule && (
          <DashboardView schedule={activeSchedule} onGoToEditor={() => setCurrentView(View.EDITOR)} onStartTutor={(s) => { setActiveSubject(s); setCurrentView(View.AI_TUTOR); }} />
        )}
        {currentView === View.EDITOR && activeSchedule && (
          <EditorView schedule={activeSchedule} onAdd={addSessionToActive} onRemove={removeSessionFromActive} />
        )}
        {currentView === View.AI_TUTOR && (
          <TutorView activeSubject={activeSubject} setActiveSubject={setActiveSubject} history={chatHistory} onSend={handleSendMessage} isTyping={isTyping} timer={timer} setTimer={setTimer} />
        )}
      </main>
      <div className="safe-bottom bg-slate-50"></div>
    </div>
  );
};

const NavButton: React.FC<{icon: React.ReactNode, active: boolean, onClick: () => void}> = ({icon, active, onClick}) => (
  <button onClick={onClick} className={`p-1.5 rounded-md transition-all ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
    {icon}
  </button>
);

const MenuView: React.FC<any> = ({schedules, activeId, onSelect, isCreating, setIsCreating, newName, setNewName, onCreate, onDelete}) => (
  <div className="max-w-4xl mx-auto p-4 animate-in fade-in duration-500">
    <div className="flex justify-between items-end mb-6">
      <div>
        <h2 className="text-xl font-black text-slate-800">Command Center</h2>
        <p className="text-slate-400 text-[10px] uppercase tracking-widest">Protocol Sync</p>
      </div>
      {!isCreating && (
        <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 shadow-lg shadow-blue-500/10">
          <Plus size={14} /> New Plan
        </button>
      )}
    </div>
    {isCreating && (
      <div className="mb-6 bg-white p-4 rounded-xl border-2 border-blue-500 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Initialization</h3>
          <button onClick={() => setIsCreating(false)} className="text-slate-300"><X size={14}/></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onCreate(); }} className="flex gap-2">
          <input autoFocus type="text" placeholder="Protocol name..." value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 bg-slate-50 p-2 rounded-lg border-none font-bold text-xs outline-none focus:ring-1 focus:ring-blue-500" />
          <button type="submit" disabled={!newName.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs disabled:opacity-50">Launch</button>
        </form>
      </div>
    )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {schedules.map((s: any) => (
        <div key={s.id} onClick={() => onSelect(s.id)} className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${activeId === s.id ? 'bg-white border-blue-500' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
          <div className="flex justify-between items-start mb-3">
            <div className={`p-2 rounded-lg ${activeId === s.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}><Calendar size={16} /></div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="p-1.5 text-slate-200 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
          <h3 className="text-sm font-black text-slate-800">{s.name}</h3>
          <p className="text-[9px] font-black text-slate-400 mt-1 uppercase tracking-widest">{s.sessions.length} nodes active</p>
        </div>
      ))}
    </div>
  </div>
);

const DashboardView: React.FC<any> = ({schedule, onGoToEditor, onStartTutor}) => {
  const now = new Date();
  const currentDay = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const sortedSessions = [...schedule.sessions].filter((s: any) => s.day === currentDay).sort((a: any,b: any) => a.startTime.localeCompare(b.startTime));
  const currentSession = sortedSessions.find((s: any) => {
    const [h, m] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    const start = new Date(); start.setHours(h, m, 0);
    const end = new Date(); end.setHours(eh, em, 0);
    return now >= start && now <= end;
  });

  return (
    <div className="max-w-5xl mx-auto p-4 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 rounded-2xl p-6 text-white relative overflow-hidden shadow-xl">
            <div className="relative z-10">
              <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full text-[8px] font-black tracking-widest uppercase border border-white/5 mb-3 inline-block">{schedule.name}</span>
              <h2 className="text-xl font-black mb-1 uppercase tracking-tight">{currentSession ? `${currentSession.subject} Active` : "System Standby"}</h2>
              <p className="text-slate-400 text-xs mb-4">{currentSession ? `Current task active until ${currentSession.endTime}.` : "No active protocols scheduled for this hour."}</p>
              <div className="flex gap-2">
                {currentSession && (
                  <button onClick={() => onStartTutor(currentSession.subject)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-1.5 text-xs">
                    <Zap size={14} fill="currentColor" /> Neural Tutor
                  </button>
                )}
                <button onClick={onGoToEditor} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-xs border border-white/5">Modify</button>
              </div>
            </div>
            <BrainCircuit size={80} className="absolute -right-4 -bottom-4 text-white opacity-5 pointer-events-none" />
          </div>
          <section>
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Today's Sequence — {currentDay}</h3>
            <div className="space-y-2">
              {sortedSessions.map((s: any) => (
                <div key={s.id} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm group hover:border-blue-400 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg text-white shadow-sm ${SUBJECT_INFO[s.subject as Subject].color}`}>{SUBJECT_INFO[s.subject as Subject].icon}</div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-800">{s.subject}</h4>
                      <p className="text-slate-400 text-[9px] font-black uppercase">{s.startTime} — {s.endTime}</p>
                    </div>
                  </div>
                  <button onClick={() => onStartTutor(s.subject)} className="p-2 rounded-lg bg-slate-50 text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition-all"><ChevronRight size={16} /></button>
                </div>
              ))}
              {sortedSessions.length === 0 && <p className="text-slate-300 text-[10px] text-center py-4 uppercase font-black">No nodes scheduled</p>}
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-lg">
            <h4 className="text-[10px] font-black mb-3 flex items-center gap-2 text-slate-400 uppercase tracking-widest"><BookOpen size={14} className="text-blue-500" /> Subject Nodes</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {SUBJECTS.map(s => (
                <button key={s} onClick={() => onStartTutor(s)} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-all text-left">
                  <span className="text-lg">{SUBJECT_INFO[s].icon}</span>
                  <span className="font-bold text-slate-700 text-[10px] truncate">{s}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const EditorView: React.FC<any> = ({schedule, onAdd, onRemove}) => {
  const [day, setDay] = useState<DayOfWeek>('Monday');
  const [subject, setSubject] = useState<Subject>('Math');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:30');
  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-lg mb-4">
        <h2 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-widest">Protocol Editor: {schedule.name}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full bg-slate-50 p-2 rounded-lg border-none font-bold text-xs outline-none focus:ring-1 focus:ring-blue-500 appearance-none">
              {SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Day</label>
            <select value={day} onChange={e => setDay(e.target.value as DayOfWeek)} className="w-full bg-slate-50 p-2 rounded-lg border-none font-bold text-xs outline-none focus:ring-1 focus:ring-blue-500 appearance-none">
              {DAYS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase text-center block">Start</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-slate-50 p-2 rounded-lg border-none font-bold text-center text-xs outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase text-center block">End</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-slate-50 p-2 rounded-lg border-none font-bold text-center text-xs outline-none" />
            </div>
          </div>
          <button onClick={() => onAdd({ subject, day, startTime: start, endTime: end })} className="bg-blue-600 text-white p-2 rounded-lg font-bold text-xs shadow-md">Add Node</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 shadow-md overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-slate-100">
            {DAYS.map(d => (
              <tr key={d} className="group hover:bg-slate-50/50">
                <td className="px-4 py-3 font-black text-slate-800 w-24 align-top">{d}</td>
                <td className="px-4 py-3 flex flex-wrap gap-1.5">
                  {schedule.sessions.filter((s:any) => s.day === d).map((s:any) => (
                    <div key={s.id} className="flex items-center gap-2 bg-slate-50 border border-slate-100 px-2 py-1 rounded-md">
                      <span className="font-bold text-slate-700 text-[10px]">{s.subject}</span>
                      <span className="text-[8px] text-slate-400">{s.startTime}</span>
                      <button onClick={() => onRemove(s.id)} className="text-slate-300 hover:text-red-500"><X size={10} /></button>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TutorView: React.FC<any> = ({activeSubject, setActiveSubject, history, onSend, isTyping, timer, setTimer}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [history, isTyping, activeSubject]);

  if (!activeSubject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white">
        <div className="bg-slate-900 p-4 rounded-2xl mb-6 text-blue-500 shadow-lg animate-pulse"><BrainCircuit size={32} /></div>
        <h2 className="text-sm font-black text-slate-800 mb-6 uppercase tracking-widest">Select AI Specialist</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-lg px-2">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => setActiveSubject(s)} className="bg-white p-3 rounded-lg border border-slate-100 hover:border-blue-500 hover:shadow-md transition-all flex flex-col items-center gap-1 group active:scale-95">
              <span className="text-2xl group-hover:scale-110 transition-transform">{SUBJECT_INFO[s].icon}</span>
              <span className="font-black text-slate-800 text-[9px] tracking-tight uppercase">{s}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-white overflow-hidden animate-in zoom-in-95 duration-500">
      <div className="w-full md:w-52 bg-slate-50 border-r border-slate-100 p-4 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar">
        <div>
          <button onClick={() => setActiveSubject(null as any)} className="mb-6 group p-1.5 hover:bg-slate-200 rounded-md transition-all flex items-center gap-2 font-black text-slate-400 text-[8px] tracking-widest uppercase">
            <ChevronLeft size={12} /> Back
          </button>
          <div className="mb-6 text-center">
            <div className={`w-14 h-14 rounded-xl mx-auto flex items-center justify-center text-2xl shadow-md mb-2 ring-2 ring-white ${SUBJECT_INFO[activeSubject].color} text-white`}>{SUBJECT_INFO[activeSubject].icon}</div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">{activeSubject}</h3>
            <p className="text-blue-500 text-[7px] font-black uppercase tracking-widest mt-0.5 opacity-40">Specialist Linked</p>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 text-center space-y-2">
            <div className="text-xl font-black text-slate-900 tracking-tighter tabular-nums">{formatTime(timer.timeLeft)}</div>
            <div className="flex justify-center gap-1.5">
              <button onClick={() => setTimer((t:any) => ({...t, isActive: !t.isActive}))} className={`p-1.5 rounded-md transition-all ${timer.isActive ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white shadow-blue-500/20 shadow'}`}>
                {timer.isActive ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              </button>
              <button onClick={() => setTimer((t:any) => ({...t, isActive: false, timeLeft: 25 * 60, mode: 'study'}))} className="p-1.5 bg-slate-100 text-slate-400 rounded-md hover:bg-slate-200"><RotateCcw size={14} /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[radial-gradient(#f1f5f9_1px,transparent_1px)] [background-size:16px_16px]">
          {history[activeSubject].map((msg:any) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-1 duration-300`}>
              <div className={`max-w-[90%] sm:max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-50 text-slate-800 rounded-tl-none border border-slate-100'}`}>
                <p className="whitespace-pre-wrap leading-relaxed text-xs font-medium">{msg.content}</p>
                <div className={`flex items-center gap-1 mt-1 opacity-20 text-[6px] font-black uppercase ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}><Clock size={6} /> {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-slate-50 border border-slate-100 rounded-lg rounded-tl-none px-2 py-1.5 shadow-sm flex gap-1">
                <div className="w-1 h-1 bg-blue-300 rounded-full animate-bounce"></div>
                <div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:0.1s]"></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-2.5 bg-white/95 backdrop-blur-md border-t border-slate-100 safe-bottom">
           <form className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200 focus-within:border-blue-400 focus-within:bg-white transition-all shadow-sm" 
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isTyping) return;
              onSend(activeSubject, input);
              setInput('');
            }}>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={isTyping} placeholder={`Neural input for ${activeSubject}...`} className="flex-1 bg-transparent px-2 py-1.5 outline-none font-bold text-slate-800 placeholder:text-slate-300 disabled:opacity-50 text-xs" />
            <button type="submit" disabled={!input.trim() || isTyping} className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md active:scale-95 shrink-0">
              <Play size={14} fill="currentColor" />
            </button>
          </form>
          <p className="text-[6px] font-black text-slate-200 uppercase tracking-widest mt-1.5 text-center">Protocol Stream Secure</p>
        </div>
      </div>
    </div>
  );
};

export default App;