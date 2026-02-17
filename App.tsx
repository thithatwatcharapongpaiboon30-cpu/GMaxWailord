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
      <header className="h-14 bg-white/80 backdrop-blur-md border-b px-4 flex items-center justify-between z-50 shrink-0 shadow-sm safe-top">
        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setCurrentView(View.MENU)}>
          <div className="bg-blue-600 p-1.5 rounded-lg group-hover:rotate-12 transition-transform shadow-lg shadow-blue-500/20">
            <BrainCircuit className="text-white" size={18} />
          </div>
          <h1 className="text-base font-black tracking-tight hidden sm:block">MedQuest AI</h1>
        </div>
        <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <NavButton icon={<LayoutDashboard size={16}/>} active={currentView === View.DASHBOARD} onClick={() => activeSchedule ? setCurrentView(View.DASHBOARD) : setCurrentView(View.MENU)} />
          <NavButton icon={<Calendar size={16}/>} active={currentView === View.EDITOR} onClick={() => activeSchedule ? setCurrentView(View.EDITOR) : setCurrentView(View.MENU)} />
          <NavButton icon={<MessageSquare size={16}/>} active={currentView === View.AI_TUTOR} onClick={() => setCurrentView(View.AI_TUTOR)} />
        </nav>
        <div className="flex items-center gap-1">
           <button onClick={requestNotificationPermission} className={`p-2 rounded-lg transition-all ${notificationPermission === 'granted' ? 'text-emerald-500 bg-emerald-50' : 'text-slate-400'}`}>
            {notificationPermission === 'granted' ? <Bell size={18} /> : <BellOff size={18} />}
          </button>
           <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-2 rounded-lg transition-all ${isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'text-slate-400'}`}>
            <Volume2 size={18} />
          </button>
        </div>
      </header>

      {showIosGuide && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
           <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><Info size={24}/></div>
                <button onClick={() => setShowIosGuide(false)} className="p-2 text-slate-300"><X size={20}/></button>
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Enable Notifications</h3>
              <p className="text-slate-500 mb-6 text-sm leading-relaxed">Add to Home Screen for session alerts on iOS.</p>
              <button onClick={() => setShowIosGuide(false)} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Got it</button>
           </div>
        </div>
      )}

      {notification && (
        <div className="fixed top-16 right-4 left-4 sm:left-auto z-[100] p-4 rounded-2xl shadow-xl border-l-4 bg-slate-900 text-white animate-in slide-in-from-top-4 duration-300 sm:min-w-[280px]">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-white/10 rounded-lg"><Bell size={18} /></div>
            <p className="font-bold text-xs flex-1">{notification.message}</p>
            <button onClick={() => setNotification(null)} className="opacity-40"><X size={14}/></button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto custom-scrollbar relative">
        {currentView === View.MENU && (
          <MenuView schedules={schedules} activeId={activeScheduleId} onSelect={(id) => { setActiveScheduleId(id); setCurrentView(View.DASHBOARD); }} isCreating={isCreatingSchedule} setIsCreating={setIsCreatingSchedule} newName={newScheduleName} setNewName={setNewScheduleName} onCreate={handleCreateSchedule} onDelete={(id) => { if (confirm("Delete this plan?")) { setSchedules(prev => prev.filter(s => s.id !== id)); if (activeScheduleId === id) setActiveScheduleId(null); } }} permission={notificationPermission} onRequestPermission={requestNotificationPermission} onShowIosGuide={() => setShowIosGuide(true)} />
        )}
        {(currentView === View.DASHBOARD || currentView === View.EDITOR) && !activeSchedule && (
           <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-white">
              <div className="bg-slate-50 p-8 rounded-full mb-4"><Calendar size={48} className="text-slate-200" /></div>
              <h2 className="text-2xl font-black text-slate-800 mb-2">No Active Protocol</h2>
              <button onClick={() => setCurrentView(View.MENU)} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-500/20">Go to Command Center</button>
           </div>
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
  <button onClick={onClick} className={`p-2 rounded-lg transition-all ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}>
    {icon}
  </button>
);

const MenuView: React.FC<any> = ({schedules, activeId, onSelect, isCreating, setIsCreating, newName, setNewName, onCreate, onDelete, permission, onRequestPermission, onShowIosGuide}) => (
  <div className="max-w-4xl mx-auto p-6 animate-in fade-in duration-500">
    <div className="flex justify-between items-end mb-8 gap-4">
      <div>
        <h2 className="text-2xl font-black text-slate-800">Command Center</h2>
        <p className="text-slate-400 text-sm">Synchronize your preparations.</p>
      </div>
      <div className="flex gap-2">
        {!isCreating && (
          <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-1 shadow-lg shadow-blue-500/20">
            <Plus size={16} /> New Plan
          </button>
        )}
      </div>
    </div>
    {isCreating && (
      <div className="mb-8 bg-white p-6 rounded-2xl border-2 border-blue-500 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">New Schedule</h3>
          <button onClick={() => setIsCreating(false)} className="text-slate-300"><X size={18}/></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onCreate(); }} className="flex gap-2">
          <input autoFocus type="text" placeholder="Schedule name..." value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 bg-slate-50 p-3 rounded-xl border-none font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
          <button type="submit" disabled={!newName.trim()} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold disabled:opacity-50">Launch</button>
        </form>
      </div>
    )}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {schedules.map((s: any) => (
        <div key={s.id} onClick={() => onSelect(s.id)} className={`group relative p-6 rounded-2xl cursor-pointer border-2 transition-all ${activeId === s.id ? 'bg-white border-blue-500' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
          <div className="flex justify-between items-start mb-4">
            <div className={`p-3 rounded-xl ${activeId === s.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}><Calendar size={20} /></div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="p-2 text-slate-200 hover:text-red-500"><Trash2 size={18} /></button>
          </div>
          <h3 className="text-lg font-black text-slate-800">{s.name}</h3>
          <p className="text-xs font-bold text-slate-400 mt-2 uppercase tracking-widest">{s.sessions.length} sessions</p>
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
    <div className="max-w-5xl mx-auto p-6 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-2xl">
            <div className="relative z-10">
              <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border border-white/5 mb-4 inline-block">{schedule.name}</span>
              <h2 className="text-3xl font-black mb-2 uppercase tracking-tighter">{currentSession ? `${currentSession.subject} Active` : "System Idle"}</h2>
              <p className="text-slate-400 text-sm mb-6 max-w-xs">{currentSession ? `Session until ${currentSession.endTime}.` : "Awaiting next session."}</p>
              <div className="flex gap-2">
                {currentSession && (
                  <button onClick={() => onStartTutor(currentSession.subject)} className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold flex items-center gap-2 text-sm shadow-xl">
                    <Zap size={18} fill="currentColor" /> Neural Tutor
                  </button>
                )}
                <button onClick={onGoToEditor} className="bg-slate-800 text-white px-5 py-3 rounded-xl font-bold text-sm border border-white/10">Sync</button>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none scale-150 transform translate-x-1/4 -translate-y-1/4"><BrainCircuit size={120} /></div>
          </div>
          <section>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Today's Protocol — {currentDay}</h3>
            <div className="space-y-3">
              {sortedSessions.map((s: any) => (
                <div key={s.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between shadow-sm group hover:border-blue-400 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl text-white shadow-md ${SUBJECT_INFO[s.subject as Subject].color}`}>{SUBJECT_INFO[s.subject as Subject].icon}</div>
                    <div>
                      <h4 className="font-bold text-slate-800">{s.subject}</h4>
                      <p className="text-slate-400 text-[10px] font-black uppercase">{s.startTime} — {s.endTime}</p>
                    </div>
                  </div>
                  <button onClick={() => onStartTutor(s.subject)} className="p-3 rounded-xl bg-slate-50 text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition-all"><ChevronRight size={20} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside>
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xl">
            <h4 className="font-black mb-4 flex items-center gap-2 text-slate-700 text-xs uppercase tracking-widest"><BookOpen size={16} className="text-blue-500" /> Neural Nodes</h4>
            <div className="space-y-1">
              {SUBJECTS.map(s => (
                <button key={s} onClick={() => onStartTutor(s)} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-all group">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{SUBJECT_INFO[s].icon}</span>
                    <span className="font-bold text-slate-700 text-sm">{s}</span>
                  </div>
                  <MessageSquare size={14} className="text-slate-200 group-hover:text-blue-500" />
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
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xl mb-6">
        <h2 className="text-lg font-black text-slate-800 mb-6">Editor: {schedule.name}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full bg-slate-50 p-3 rounded-xl border-none font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none">
              {SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Day</label>
            <select value={day} onChange={e => setDay(e.target.value as DayOfWeek)} className="w-full bg-slate-50 p-3 rounded-xl border-none font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none">
              {DAYS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase text-center block">Start</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-slate-50 p-3 rounded-xl border-none font-bold text-center text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase text-center block">End</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-slate-50 p-3 rounded-xl border-none font-bold text-center text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
          </div>
          <button onClick={() => onAdd({ subject, day, startTime: start, endTime: end })} className="bg-blue-600 text-white p-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 flex items-center justify-center gap-1">
            <Plus size={16} /> Add
          </button>
        </div>
      </div>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
        <table className="w-full text-left">
          <tbody className="divide-y divide-slate-100">
            {DAYS.map(d => (
              <tr key={d} className="group hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-black text-sm text-slate-800 w-32 align-top">{d}</td>
                <td className="px-6 py-4 flex flex-wrap gap-2">
                  {schedule.sessions.filter((s:any) => s.day === d).map((s:any) => (
                    <div key={s.id} className="flex items-center gap-3 bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-700">{s.subject}</span>
                        <span className="text-[9px] text-slate-400 font-black">{s.startTime}-{s.endTime}</span>
                      </div>
                      <button onClick={() => onRemove(s.id)} className="text-slate-200 hover:text-red-500"><Trash2 size={12} /></button>
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
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-white">
        <div className="bg-slate-900 p-6 rounded-3xl mb-8 text-blue-500 shadow-2xl animate-pulse"><BrainCircuit size={40} /></div>
        <h2 className="text-xl font-black text-slate-800 mb-6 uppercase tracking-tighter">Specialist Selection</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-xl px-4">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => setActiveSubject(s)} className="bg-white p-4 rounded-xl border border-slate-100 hover:border-blue-500 hover:shadow-lg transition-all flex flex-col items-center gap-2 group active:scale-95">
              <span className="text-3xl group-hover:scale-110 transition-transform duration-300">{SUBJECT_INFO[s].icon}</span>
              <span className="font-black text-slate-800 text-[10px] tracking-tight uppercase">{s}</span>
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
      <div className="w-full md:w-60 bg-slate-50 border-r border-slate-100 p-5 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar">
        <div>
          <button onClick={() => setActiveSubject(null as any)} className="mb-6 group p-2 hover:bg-slate-200 rounded-lg transition-all flex items-center gap-2 font-black text-slate-400 text-[9px] tracking-widest uppercase">
            <ChevronLeft size={14} /> Back
          </button>
          <div className="mb-8 text-center">
            <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-lg mb-3 ring-4 ring-white ${SUBJECT_INFO[activeSubject].color} text-white`}>{SUBJECT_INFO[activeSubject].icon}</div>
            <h3 className="text-base font-black text-slate-800 tracking-tighter uppercase">{activeSubject}</h3>
            <p className="text-blue-500 text-[8px] font-black uppercase tracking-[0.2em] mt-1 opacity-50">Active Link</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-md border border-slate-100 text-center space-y-3">
            <div className="text-2xl font-black text-slate-900 tracking-tighter tabular-nums">{formatTime(timer.timeLeft)}</div>
            <div className="flex justify-center gap-2">
              <button onClick={() => setTimer((t:any) => ({...t, isActive: !t.isActive}))} className={`p-2 rounded-lg font-bold shadow transition-all ${timer.isActive ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white shadow-blue-500/30'}`}>
                {timer.isActive ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button onClick={() => setTimer((t:any) => ({...t, isActive: false, timeLeft: 25 * 60, mode: 'study'}))} className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-slate-200"><RotateCcw size={18} /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar bg-[radial-gradient(#e2e8f0_0.5px,transparent_0.5px)] [background-size:20px:20px]">
          {history[activeSubject].map((msg:any) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'}`}>
                <p className="whitespace-pre-wrap leading-relaxed text-sm font-medium">{msg.content}</p>
                <div className={`flex items-center gap-1 mt-1.5 opacity-30 text-[7px] font-black uppercase ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}><Clock size={7} /> {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 rounded-xl rounded-tl-none px-3 py-2 shadow-sm flex gap-1">
                <div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-3 bg-white/95 backdrop-blur-xl border-t border-slate-100 safe-bottom">
           <form className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 focus-within:border-blue-500 focus-within:bg-white transition-all shadow-sm" 
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isTyping) return;
              onSend(activeSubject, input);
              setInput('');
            }}>
            <div className={`w-8 h-8 rounded-lg ${SUBJECT_INFO[activeSubject].color} text-white flex items-center justify-center text-lg shadow hidden sm:flex shrink-0`}>{SUBJECT_INFO[activeSubject].icon}</div>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={isTyping} placeholder={`Ask ${activeSubject}...`} className="flex-1 bg-transparent px-2 py-2 outline-none font-bold text-slate-800 placeholder:text-slate-300 disabled:opacity-50 text-sm" />
            <button type="submit" disabled={!input.trim() || isTyping} className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all shadow active:scale-90 flex items-center justify-center shrink-0">
              <Play size={16} fill="currentColor" />
            </button>
          </form>
          <p className="text-[7px] font-black text-slate-200 uppercase tracking-[0.3em] mt-2 text-center">Neural Link Synced</p>
        </div>
      </div>
    </div>
  );
};

export default App;