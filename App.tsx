
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
  
  // Persistent state for schedules
  const [schedules, setSchedules] = useState<Schedule[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Persistent state for active schedule selection
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

  // Timer State
  const [timer, setTimer] = useState<TimerState>({ isActive: false, timeLeft: 25 * 60, mode: 'study' });

  // Sync to Local Storage
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

  // Handle Notifications Permission
  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    
    // Check if on iOS and not standalone
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isStandalone) {
      // Small delay to not annoy immediately
      setTimeout(() => setShowIosGuide(true), 2000);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      // Trigger a haptic feedback if possible
      if (navigator.vibrate) navigator.vibrate(50);
      
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        triggerNotification("Notifications enabled!", "success");
      } else if (permission === 'denied') {
        triggerNotification("Permissions blocked by browser.", "error");
      }
    } else {
      triggerNotification("Your device doesn't support notifications.", "error");
    }
  };

  // Pomodoro Timer Logic
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

  // Session Notification Engine
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
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      
      if (notificationPermission === 'granted') {
        try {
          new Notification("MedQuest Assistant", {
            body: msg,
            icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
            silent: false,
          });
        } catch (e) {
          console.error("System notification failed:", e);
        }
      }
    }

    setTimeout(() => setNotification(null), 5000);
  };

  const handleCreateSchedule = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newScheduleName.trim()) return;
    
    const newSchedule: Schedule = {
      id: `plan-${Date.now()}`,
      name: newScheduleName.trim(),
      sessions: [],
      createdAt: Date.now()
    };
    
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
      
      if (isVoiceEnabled) {
        await speakText(responseText);
      }
    }
  };

  const addSessionToActive = (session: Omit<StudySession, 'id'>) => {
    if (!activeScheduleId) {
      triggerNotification("Selection required", "error");
      return;
    }
    
    setSchedules(prev => {
      const updated = prev.map(s => {
        if (s.id === activeScheduleId) {
          const newSession = { ...session, id: `session-${Math.random().toString(36).substr(2, 9)}` };
          return { ...s, sessions: [...s.sessions, newSession] };
        }
        return s;
      });
      return updated;
    });
    triggerNotification(`${session.subject} session added`, 'success');
  };

  const removeSessionFromActive = (sessionId: string) => {
    setSchedules(prev => prev.map(s => {
      if (s.id === activeScheduleId) {
        return { ...s, sessions: s.sessions.filter(sess => sess.id !== sessionId) };
      }
      return s;
    }));
  };

  const activeSchedule = useMemo(() => schedules.find(s => s.id === activeScheduleId), [schedules, activeScheduleId]);

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden font-inter select-none">
      {/* App Header */}
      <header className="h-16 bg-white/80 backdrop-blur-md border-b px-6 flex items-center justify-between z-50 shrink-0 shadow-sm safe-top">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setCurrentView(View.MENU)}>
          <div className="bg-blue-600 p-2 rounded-xl group-hover:rotate-12 transition-transform shadow-lg shadow-blue-500/20">
            <BrainCircuit className="text-white" size={20} />
          </div>
          <h1 className="text-lg font-black tracking-tight hidden sm:block">MedQuest AI</h1>
        </div>

        <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
          <NavButton icon={<LayoutDashboard size={18}/>} active={currentView === View.DASHBOARD} onClick={() => activeSchedule ? setCurrentView(View.DASHBOARD) : setCurrentView(View.MENU)} />
          <NavButton icon={<Calendar size={18}/>} active={currentView === View.EDITOR} onClick={() => activeSchedule ? setCurrentView(View.EDITOR) : setCurrentView(View.MENU)} />
          <NavButton icon={<MessageSquare size={18}/>} active={currentView === View.AI_TUTOR} onClick={() => setCurrentView(View.AI_TUTOR)} />
        </nav>

        <div className="flex items-center gap-2">
           <button 
            onClick={requestNotificationPermission}
            className={`p-2 rounded-xl transition-all active:scale-90 ${notificationPermission === 'granted' ? 'text-emerald-500 bg-emerald-50' : 'text-slate-400 bg-slate-50 hover:bg-slate-100'}`}
            title="Enable System Notifications"
          >
            {notificationPermission === 'granted' ? <Bell size={20} /> : <BellOff size={20} />}
          </button>
           <button 
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            className={`p-2 rounded-xl transition-all active:scale-90 ${isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
            title="Toggle AI Voice"
          >
            <Volume2 size={20} />
          </button>
        </div>
      </header>

      {/* iOS Guide Modal */}
      {showIosGuide && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="flex justify-between items-start mb-6">
                <div className="p-4 bg-blue-50 text-blue-600 rounded-3xl"><Info size={32}/></div>
                <button onClick={() => setShowIosGuide(false)} className="p-2 text-slate-300 hover:text-slate-600"><X size={24}/></button>
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-3 tracking-tight">Enable iOS Notifications</h3>
              <p className="text-slate-500 mb-8 leading-relaxed">To receive study session alerts on your iPhone or iPad, you must add this app to your Home Screen:</p>
              <div className="space-y-4 mb-8">
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <div className="w-8 h-8 bg-white shadow-sm rounded-lg flex items-center justify-center text-blue-600"><Share size={18}/></div>
                  <p className="text-sm font-bold text-slate-700">1. Tap the Share button</p>
                </div>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <div className="w-8 h-8 bg-white shadow-sm rounded-lg flex items-center justify-center text-blue-600"><Plus size={18}/></div>
                  <p className="text-sm font-bold text-slate-700">2. Select "Add to Home Screen"</p>
                </div>
              </div>
              <button onClick={() => setShowIosGuide(false)} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">Got it</button>
           </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-20 right-4 left-4 sm:left-auto z-[100] p-5 rounded-[1.5rem] shadow-2xl border-l-8 animate-in slide-in-from-top-10 sm:slide-in-from-right duration-300 sm:min-w-[320px] ${
          notification.type === 'start' ? 'bg-blue-600 text-white border-blue-900' : 
          notification.type === 'error' ? 'bg-red-600 text-white border-red-900' :
          notification.type === 'success' ? 'bg-slate-900 text-white border-emerald-500' : 'bg-emerald-600 text-white border-emerald-900'
        }`}>
          <div className="flex items-center gap-4">
            <div className="p-2 bg-white/20 rounded-xl">
              {notification.type === 'success' ? <CheckCircle className="text-emerald-400" size={24} /> : <Bell size={24} />}
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm tracking-tight leading-tight">{notification.message}</p>
              <p className="text-[10px] opacity-70 font-black uppercase tracking-[0.2em] mt-1">MedQuest Protocol</p>
            </div>
            <button onClick={() => setNotification(null)} className="opacity-40 hover:opacity-100 transition-opacity"><X size={16}/></button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 overflow-y-auto custom-scrollbar relative">
        {currentView === View.MENU && (
          <MenuView 
            schedules={schedules} 
            activeId={activeScheduleId} 
            onSelect={(id) => { setActiveScheduleId(id); setCurrentView(View.DASHBOARD); }}
            isCreating={isCreatingSchedule}
            setIsCreating={setIsCreatingSchedule}
            newName={newScheduleName}
            setNewName={setNewScheduleName}
            onCreate={handleCreateSchedule}
            onDelete={(id) => {
              if (confirm("Delete this plan forever?")) {
                setSchedules(prev => prev.filter(s => s.id !== id));
                if (activeScheduleId === id) setActiveScheduleId(null);
              }
            }}
            permission={notificationPermission}
            onRequestPermission={requestNotificationPermission}
            onShowIosGuide={() => setShowIosGuide(true)}
          />
        )}

        {(currentView === View.DASHBOARD || currentView === View.EDITOR) && !activeSchedule && (
           <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-white">
              <div className="bg-slate-50 p-10 rounded-[3rem] mb-6">
                <Calendar size={80} className="text-slate-200" />
              </div>
              <h2 className="text-3xl font-black text-slate-800 mb-2">Interface Offline</h2>
              <p className="text-slate-400 max-w-sm mb-10 font-medium leading-relaxed">No active protocol detected. Please select or initialize a study schedule from the command center.</p>
              <button onClick={() => setCurrentView(View.MENU)} className="bg-blue-600 text-white px-10 py-4 rounded-[1.5rem] font-black shadow-2xl hover:bg-blue-700 transition-all hover:scale-105 active:scale-95 shadow-blue-500/20">Go to Command Center</button>
           </div>
        )}

        {currentView === View.DASHBOARD && activeSchedule && (
          <DashboardView 
            schedule={activeSchedule} 
            onGoToEditor={() => setCurrentView(View.EDITOR)}
            onStartTutor={(s) => { setActiveSubject(s); setCurrentView(View.AI_TUTOR); }}
          />
        )}

        {currentView === View.EDITOR && activeSchedule && (
          <EditorView 
            schedule={activeSchedule} 
            onAdd={addSessionToActive}
            onRemove={removeSessionFromActive}
          />
        )}

        {currentView === View.AI_TUTOR && (
          <TutorView 
            activeSubject={activeSubject} 
            setActiveSubject={setActiveSubject} 
            history={chatHistory} 
            onSend={handleSendMessage}
            isTyping={isTyping}
            timer={timer}
            setTimer={setTimer}
          />
        )}
      </main>
      <div className="safe-bottom bg-slate-50"></div>
    </div>
  );
};

// --- View Components ---

const NavButton: React.FC<{icon: React.ReactNode, active: boolean, onClick: () => void}> = ({icon, active, onClick}) => (
  <button 
    onClick={onClick}
    className={`p-3 rounded-xl transition-all active:scale-90 ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}
  >
    {icon}
  </button>
);

const MenuView: React.FC<{
  schedules: Schedule[], 
  activeId: string | null, 
  onSelect: (id: string) => void, 
  isCreating: boolean,
  setIsCreating: (v: boolean) => void,
  newName: string,
  setNewName: (v: string) => void,
  onCreate: () => void, 
  onDelete: (id: string) => void,
  permission: NotificationPermission,
  onRequestPermission: () => void,
  onShowIosGuide: () => void
}> = ({schedules, activeId, onSelect, isCreating, setIsCreating, newName, setNewName, onCreate, onDelete, permission, onRequestPermission, onShowIosGuide}) => (
  <div className="max-w-4xl mx-auto p-8 animate-in fade-in duration-500">
    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
      <div>
        <h2 className="text-4xl font-black text-slate-800 tracking-tight">Command Center</h2>
        <p className="text-slate-500 font-medium text-lg mt-1">Synchronize your medical entrance prep.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {permission !== 'granted' && (
          <button onClick={onRequestPermission} className="bg-amber-100 text-amber-700 px-5 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-amber-200 transition-colors shadow-sm">
            <Bell size={18} /> Enable Alerts
          </button>
        )}
        <button onClick={onShowIosGuide} className="bg-white border text-slate-500 p-3 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm">
           <Info size={20} />
        </button>
        {!isCreating && (
          <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black shadow-xl hover:bg-blue-700 transition-all flex items-center gap-2 hover:scale-105 active:scale-95 shadow-blue-500/30">
            <Plus size={20} /> New Plan
          </button>
        )}
      </div>
    </div>

    {isCreating && (
      <div className="mb-10 bg-white p-8 rounded-[2.5rem] border-2 border-blue-500 shadow-2xl animate-in slide-in-from-top-6 duration-500">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
             <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><Calendar size={24}/></div>
             <h3 className="text-xl font-black text-slate-800 tracking-tight">Protocol Initialization</h3>
          </div>
          <button onClick={() => setIsCreating(false)} className="p-2 text-slate-300 hover:text-slate-600 transition-colors"><X size={24}/></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onCreate(); }} className="flex flex-col sm:flex-row gap-4">
          <input 
            autoFocus
            type="text" 
            placeholder="e.g. Intensive TPAT1 Protocol" 
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 bg-slate-50 p-5 rounded-2xl border-none font-black text-lg outline-none ring-2 ring-transparent focus:ring-blue-500 focus:bg-white transition-all shadow-inner"
          />
          <button type="submit" disabled={!newName.trim()} className="bg-blue-600 text-white px-10 py-5 rounded-2xl font-black text-lg disabled:opacity-50 shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all">Launch</button>
        </form>
      </div>
    )}

    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {schedules.map(s => (
        <div key={s.id} onClick={() => onSelect(s.id)} className={`group relative p-8 rounded-[2.5rem] cursor-pointer border-2 transition-all shadow-sm ${activeId === s.id ? 'bg-white border-blue-500 ring-[12px] ring-blue-50' : 'bg-white border-slate-100 hover:border-blue-200 hover:shadow-xl'}`}>
          <div className="flex justify-between items-start mb-6">
            <div className={`p-4 rounded-2xl shadow-lg transition-transform group-hover:scale-110 ${activeId === s.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500'}`}>
              <Calendar size={28} />
            </div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="p-3 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-2xl opacity-0 group-hover:opacity-100 transition-all">
              <Trash2 size={24} />
            </button>
          </div>
          <h3 className="text-2xl font-black text-slate-800 mb-2 leading-tight tracking-tight">{s.name}</h3>
          <div className="flex items-center justify-between mt-6">
            <div className="flex items-center gap-2">
               <span className="text-slate-400 text-sm font-black uppercase tracking-widest">{s.sessions.length} sessions</span>
            </div>
            {activeId === s.id && <span className="flex items-center gap-1.5 text-blue-600 text-xs font-black uppercase tracking-[0.2em] bg-blue-50 px-3 py-1.5 rounded-full">Active</span>}
          </div>
        </div>
      ))}
      
      {schedules.length === 0 && !isCreating && (
        <div className="col-span-full py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100 text-slate-300">
          <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Calendar size={48} className="opacity-20" />
          </div>
          <h3 className="text-xl font-bold text-slate-400">Database Empty</h3>
          <p className="mb-10 text-slate-400 font-medium">Initialize your first study schedule to begin.</p>
          <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-12 py-4 rounded-2xl font-black shadow-2xl hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all shadow-blue-500/20">Initialize Database</button>
        </div>
      )}
    </div>
  </div>
);

const DashboardView: React.FC<{schedule: Schedule, onGoToEditor: () => void, onStartTutor: (s: Subject) => void}> = ({schedule, onGoToEditor, onStartTutor}) => {
  const now = new Date();
  const currentDay = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const sortedSessions = [...schedule.sessions].filter(s => s.day === currentDay).sort((a,b) => a.startTime.localeCompare(b.startTime));
  
  const currentSession = sortedSessions.find(s => {
    const [h, m] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    const start = new Date(); start.setHours(h, m, 0);
    const end = new Date(); end.setHours(eh, em, 0);
    return now >= start && now <= end;
  });

  return (
    <div className="max-w-6xl mx-auto p-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-10">
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 rounded-[3rem] p-12 text-white relative overflow-hidden shadow-2xl border border-white/5">
            <div className="relative z-10 flex flex-col h-full justify-between gap-12">
              <div>
                <div className="flex items-center gap-3 mb-6">
                   <span className="bg-blue-500/20 text-blue-200 px-4 py-2 rounded-2xl text-xs font-black tracking-widest uppercase backdrop-blur-md border border-white/5">Protocol: {schedule.name}</span>
                   <span className="bg-emerald-500/20 text-emerald-300 px-4 py-2 rounded-2xl text-xs font-black tracking-widest uppercase backdrop-blur-md border border-white/5">Status: Online</span>
                </div>
                <h2 className="text-5xl font-black mb-4 tracking-tighter uppercase">{currentSession ? `INTERFACE: ${currentSession.subject}` : "SYSTEM IDLE"}</h2>
                <p className="text-slate-400 font-medium text-xl max-w-md leading-relaxed">{currentSession ? `Protocol active until ${currentSession.endTime}. Direct neural link available.` : "Awaiting next scheduled session. Use the downtime for review."}</p>
              </div>
              <div className="flex flex-wrap gap-4">
                {currentSession && (
                  <button onClick={() => onStartTutor(currentSession.subject)} className="bg-white text-slate-900 px-10 py-5 rounded-[2rem] font-black flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-xl shadow-white/10">
                    <Zap size={24} fill="currentColor" /> Neural Tutor
                  </button>
                )}
                <button onClick={onGoToEditor} className="bg-slate-800/80 backdrop-blur-sm text-white px-8 py-5 rounded-[2rem] font-black border border-white/10 hover:bg-slate-700 transition-all active:scale-95">
                  Sync Timeline
                </button>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none scale-150 transform translate-x-1/4 -translate-y-1/4">
              <BrainCircuit size={400} />
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Daily Protocol</h3>
              <div className="flex items-center gap-3">
                 <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                 <span className="bg-white px-5 py-2 rounded-2xl border text-slate-600 font-black text-xs shadow-sm uppercase tracking-[0.2em]">{currentDay}</span>
              </div>
            </div>
            <div className="space-y-6">
              {sortedSessions.length > 0 ? sortedSessions.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 flex items-center justify-between shadow-sm group hover:border-blue-400 hover:shadow-2xl transition-all duration-300">
                  <div className="flex items-center gap-6">
                    <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-3xl text-white shadow-xl group-hover:rotate-6 transition-transform duration-300 ${SUBJECT_INFO[s.subject].color}`}>
                      {SUBJECT_INFO[s.subject].icon}
                    </div>
                    <div>
                      <h4 className="font-black text-xl text-slate-800 tracking-tight leading-tight">{s.subject}</h4>
                      <div className="flex items-center gap-3 mt-1.5">
                         <p className="text-slate-400 text-sm flex items-center gap-2 font-black uppercase tracking-[0.1em]"><Clock size={16} className="text-blue-500" /> {s.startTime} — {s.endTime}</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => onStartTutor(s.subject)} className="p-5 rounded-3xl bg-slate-50 text-slate-300 group-hover:bg-blue-600 group-hover:text-white group-hover:scale-110 active:scale-90 transition-all shadow-sm">
                    <ChevronRight size={28} />
                  </button>
                </div>
              )) : (
                <div className="bg-slate-50/50 border-2 border-dashed border-slate-100 rounded-[3rem] p-24 text-center text-slate-300">
                   <p className="font-black text-xl mb-4">Agenda Offline</p>
                   <button onClick={onGoToEditor} className="text-blue-600 font-black text-lg hover:underline flex items-center gap-3 mx-auto justify-center group">
                     <Plus size={24} className="group-hover:rotate-90 transition-transform" /> Sync Sessions
                   </button>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-8">
          <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl overflow-hidden relative">
            <h4 className="font-black mb-8 flex items-center gap-3 text-slate-700 tracking-tight"><BookOpen size={24} className="text-blue-500" /> Neural Nodes</h4>
            <div className="grid grid-cols-1 gap-3">
              {SUBJECTS.map(s => (
                <button key={s} onClick={() => onStartTutor(s)} className="flex items-center justify-between p-4 rounded-[1.5rem] hover:bg-blue-50 transition-all group border border-transparent hover:border-blue-100 active:scale-95">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl group-hover:scale-125 transition-transform duration-300">{SUBJECT_INFO[s].icon}</span>
                    <span className="font-black text-slate-700 text-lg tracking-tight uppercase">{s}</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-200 group-hover:bg-blue-500 group-hover:text-white transition-all shadow-sm">
                    <MessageSquare size={18} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const EditorView: React.FC<{schedule: Schedule, onAdd: (s: Omit<StudySession, 'id'>) => void, onRemove: (id: string) => void}> = ({schedule, onAdd, onRemove}) => {
  const [day, setDay] = useState<DayOfWeek>('Monday');
  const [subject, setSubject] = useState<Subject>('Math');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:30');

  return (
    <div className="max-w-5xl mx-auto p-8 animate-in fade-in duration-500">
      <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-2xl mb-12 relative overflow-hidden">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg"><Calendar size={28} /></div>
             <h2 className="text-3xl font-black text-slate-800 tracking-tight leading-tight">Sync Protocol: {schedule.name}</h2>
          </div>
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] bg-slate-50 px-4 py-2 rounded-full hidden sm:block">Editor Active</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Specialization</label>
            <select value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full bg-slate-50 p-5 rounded-2xl border-none font-black text-lg outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all appearance-none shadow-inner">
              {SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Timeline</label>
            <select value={day} onChange={e => setDay(e.target.value as DayOfWeek)} className="w-full bg-slate-50 p-5 rounded-2xl border-none font-black text-lg outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all appearance-none shadow-inner">
              {DAYS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-3 text-center">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Start</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-slate-50 p-5 rounded-2xl border-none font-black text-center text-lg outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all shadow-inner" />
            </div>
            <div className="space-y-3 text-center">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">End</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-slate-50 p-5 rounded-2xl border-none font-black text-center text-lg outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all shadow-inner" />
            </div>
          </div>
          <button onClick={() => { if(navigator.vibrate) navigator.vibrate(20); onAdd({ subject, day, startTime: start, endTime: end }); }} className="bg-blue-600 text-white p-5 rounded-2xl font-black text-lg shadow-2xl hover:bg-blue-700 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3 shadow-blue-500/30">
            <Plus size={24} /> Commit
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[3rem] border border-slate-100 shadow-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-12 py-8 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Timeline</th>
              <th className="px-12 py-8 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Neural Sessions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {DAYS.map(d => (
              <tr key={d} className="group hover:bg-slate-50/50 transition-colors">
                <td className="px-12 py-10 font-black text-xl text-slate-800 w-56 align-top tracking-tighter">{d}</td>
                <td className="px-12 py-10 flex flex-wrap gap-4">
                  {schedule.sessions.filter(s => s.day === d).length > 0 ? schedule.sessions.filter(s => s.day === d).map(s => (
                    <div key={s.id} className="flex items-center gap-5 bg-white border border-slate-200 px-6 py-4 rounded-[1.5rem] shadow-sm hover:border-blue-400 group/item transition-all hover:shadow-lg">
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{s.startTime} — {s.endTime}</span>
                        <span className="text-lg font-black text-slate-700 tracking-tight leading-tight uppercase">{s.subject}</span>
                      </div>
                      <div className="flex items-center gap-3">
                         <div className={`w-3 h-3 rounded-full ${SUBJECT_INFO[s.subject].color} shadow-sm`}></div>
                         <button onClick={() => { if(navigator.vibrate) navigator.vibrate(10); onRemove(s.id); }} className="p-3 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-xl opacity-0 group-hover/item:opacity-100 transition-all">
                           <Trash2 size={20} />
                         </button>
                      </div>
                    </div>
                  )) : (
                    <span className="text-slate-200 font-black uppercase text-[10px] tracking-widest py-4">No protocol logged</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TutorView: React.FC<{
  activeSubject: Subject | null, 
  setActiveSubject: (s: Subject) => void,
  history: Record<Subject, ChatMessage[]>,
  onSend: (s: Subject, text: string) => void,
  isTyping: boolean,
  timer: TimerState,
  setTimer: React.Dispatch<React.SetStateAction<TimerState>>
}> = ({activeSubject, setActiveSubject, history, onSend, isTyping, timer, setTimer}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [history, isTyping, activeSubject]);

  if (!activeSubject) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-white">
        <div className="bg-slate-900 p-10 rounded-[4rem] mb-12 text-blue-500 shadow-2xl animate-pulse ring-8 ring-blue-500/10">
          <BrainCircuit size={100} />
        </div>
        <h2 className="text-5xl font-black text-slate-800 mb-6 tracking-tighter uppercase">Initialize Specialist</h2>
        <p className="text-slate-400 max-w-xl mb-16 text-xl font-medium leading-relaxed">Select a cognitive specialization module to begin your high-fidelity study session.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-4xl px-4">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => { if(navigator.vibrate) navigator.vibrate(30); setActiveSubject(s); }} className="bg-white p-10 rounded-[3rem] border-2 border-slate-50 hover:border-blue-500 hover:shadow-[0_20px_50px_rgba(59,130,246,0.15)] hover:-translate-y-3 transition-all flex flex-col items-center gap-6 group active:scale-95">
              <span className="text-6xl group-hover:scale-125 transition-transform duration-500 drop-shadow-xl">{SUBJECT_INFO[s].icon}</span>
              <span className="font-black text-slate-800 text-xl tracking-tight uppercase">{s}</span>
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
      <div className="w-full md:w-96 bg-slate-50 border-r border-slate-100 p-10 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar">
        <div>
          <button onClick={() => setActiveSubject(null as any)} className="mb-12 group p-4 hover:bg-slate-200 rounded-[1.5rem] transition-all flex items-center gap-3 font-black text-slate-400 text-sm tracking-[0.2em] uppercase active:scale-90">
            <ChevronLeft size={24} className="group-hover:-translate-x-2 transition-transform" /> COMMAND
          </button>
          
          <div className="mb-16 text-center px-6">
            <div className={`w-36 h-36 rounded-[3.5rem] mx-auto flex items-center justify-center text-6xl shadow-2xl mb-8 ring-[12px] ring-white ${SUBJECT_INFO[activeSubject].color} text-white group-hover:rotate-12 transition-all duration-500`}>
              {SUBJECT_INFO[activeSubject].icon}
            </div>
            <h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">{activeSubject} Specialist</h3>
            <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mt-4 opacity-50">High Fidelity Link Active</p>
          </div>

          <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl shadow-blue-900/10 border border-slate-100 text-center space-y-6">
             <div className="flex justify-center gap-3 mb-2">
               <span className={`w-3 h-3 rounded-full ${timer.isActive ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-slate-200'}`}></span>
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{timer.mode} Mode</span>
            </div>
            <div className="text-7xl font-black text-slate-900 tracking-tighter tabular-nums leading-none">{formatTime(timer.timeLeft)}</div>
            <div className="flex justify-center gap-3">
              <button onClick={() => { if(navigator.vibrate) navigator.vibrate(20); setTimer(t => ({...t, isActive: !t.isActive})); }} className={`p-6 rounded-[1.5rem] font-bold shadow-2xl transition-all active:scale-90 ${timer.isActive ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white shadow-blue-500/40'}`}>
                {timer.isActive ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
              </button>
              <button onClick={() => { if(navigator.vibrate) navigator.vibrate(20); setTimer(t => ({...t, isActive: false, timeLeft: 25 * 60, mode: 'study'})); }} className="p-6 bg-slate-100 text-slate-400 rounded-[1.5rem] hover:bg-slate-200 transition-colors active:scale-90 shadow-inner">
                <RotateCcw size={32} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex-1 overflow-y-auto p-12 space-y-10 custom-scrollbar bg-[radial-gradient(#e2e8f0_1.5px,transparent_1.5px)] [background-size:32px_32px]">
          {history[activeSubject].length === 0 && (
            <div className="h-full flex flex-col items-center justify-center opacity-10 text-slate-900 pointer-events-none">
               <MessageSquare size={120} strokeWidth={1} />
               <p className="font-black uppercase tracking-[0.6em] mt-8 text-sm">Secure Neural Line Established</p>
            </div>
          )}
          {history[activeSubject].map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-6 duration-500`}>
              <div className={`max-w-[85%] rounded-[3rem] px-10 py-7 shadow-2xl ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none shadow-blue-500/30' 
                  : 'bg-white text-slate-800 rounded-tl-none border border-slate-100 shadow-slate-200/40'
              }`}>
                <p className="whitespace-pre-wrap leading-relaxed font-semibold text-xl tracking-tight">{msg.content}</p>
                <div className={`flex items-center gap-2 mt-5 opacity-40 text-[10px] font-black uppercase tracking-widest ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <Clock size={12} /> {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 rounded-[3rem] rounded-tl-none px-10 py-7 shadow-2xl">
                 <div className="flex gap-3">
                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce"></div>
                 </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-8 sm:p-10 bg-white/95 backdrop-blur-xl border-t border-slate-100 safe-bottom">
           <form 
            className="flex items-center gap-4 sm:gap-6 bg-slate-50 p-3 sm:p-4 rounded-[3rem] border-2 border-slate-200 focus-within:border-blue-500 focus-within:bg-white transition-all shadow-2xl" 
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isTyping) return;
              if(navigator.vibrate) navigator.vibrate(10);
              onSend(activeSubject, input);
              setInput('');
            }}
          >
            <div className={`w-14 h-14 rounded-full ${SUBJECT_INFO[activeSubject].color} text-white flex items-center justify-center text-3xl shadow-lg hidden sm:flex shrink-0`}>
               {SUBJECT_INFO[activeSubject].icon}
            </div>
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isTyping}
              placeholder={`Consult with ${activeSubject} Node...`}
              className="flex-1 bg-transparent px-2 sm:px-4 py-4 outline-none font-black text-slate-800 placeholder:text-slate-300 disabled:opacity-50 text-xl sm:text-2xl tracking-tight"
            />
            <button 
              type="submit" 
              disabled={!input.trim() || isTyping}
              className="bg-blue-600 text-white p-5 sm:p-7 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-all shadow-2xl shadow-blue-500/40 active:scale-90 flex items-center justify-center shrink-0"
            >
              <Play size={24} fill="currentColor" className="sm:size-32 ml-1" />
            </button>
          </form>
          <div className="flex items-center justify-center gap-6 mt-6 sm:mt-8">
             <span className="h-px bg-slate-100 flex-1"></span>
             <p className="text-[10px] font-black text-slate-200 uppercase tracking-[0.5em]">Cognitive Protocol Synced</p>
             <span className="h-px bg-slate-100 flex-1"></span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
