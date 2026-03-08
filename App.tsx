import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend
} from 'recharts';
import { View, Schedule, Subject, DayOfWeek, StudySession, ChatMessage, TimerState, SavedNote } from './types';
import { SUBJECTS, DAYS, SUBJECT_INFO } from './constants';
import { getTutorResponse, speakText, playNotificationSound, resumeAudio } from './services/geminiService';
import { 
  Plus, Calendar, MessageSquare, Trash2, 
  ChevronLeft, LayoutDashboard, Clock, 
  Settings, Bell, Play, CheckCircle, 
  ChevronRight, BrainCircuit, Volume2, Pause, RotateCcw,
  Zap, BookOpen, X, BellOff, Info, Share, TestTube,
  Maximize2, Minimize2, ExternalLink, Bookmark, Download, Copy, Save,
  RefreshCw, Database, Shield, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const STORAGE_KEY = 'med_quest_v5_schedules';
const ACTIVE_ID_KEY = 'med_quest_v5_active_id';
const API_KEY_STORAGE = 'med_quest_v5_api_key';
const NOTES_STORAGE_KEY = 'med_quest_v5_saved_notes';

const ChartRenderer: React.FC<{ content: string }> = ({ content }) => {
  try {
    const chartData = JSON.parse(content);
    const { type, data, title, xKey = 'name', yKey = 'value' } = chartData;
    
    const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

    return (
      <div className="my-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        {title && <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-800 mb-4 text-center">{title}</h4>}
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey={xKey} fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
                <Bar dataKey={yKey} fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : type === 'line' ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey={xKey} fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
                <Line type="monotone" dataKey={yKey} stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            ) : type === 'area' ? (
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey={xKey} fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis fontSize={8} tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
                <Area type="monotone" dataKey={yKey} stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
              </AreaChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={60}
                  paddingAngle={5}
                  dataKey={yKey}
                >
                  {data.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '8px', paddingTop: '10px' }} />
              </PieChart>
            ) : null}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch (e) {
    return <pre className="text-[8px] bg-red-50 p-2 rounded text-red-500">Chart Error: Invalid Data Format</pre>;
  }
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>(View.MENU);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification !== 'undefined') return Notification.permission;
    return 'default';
  });
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [timer, setTimer] = useState<TimerState>({ isActive: false, timeLeft: 25 * 60, mode: 'study' });
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('./timerWorker.js', import.meta.url));
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'TICK') {
        setTimer(t => ({ ...t, timeLeft: e.data.timeLeft }));
      } else if (e.data.type === 'EXPIRED') {
        handleTimerExpired();
      }
    };
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    // Sync permission state on mount and when window gains focus
    const syncPermission = () => {
      if (typeof Notification !== 'undefined') {
        setNotificationPermission(Notification.permission);
      }
    };
    window.addEventListener('focus', syncPermission);
    syncPermission();
    return () => window.removeEventListener('focus', syncPermission);
  }, []);

  const [savedNotes, setSavedNotes] = useState<SavedNote[]>(() => {
    try {
      const saved = localStorage.getItem(NOTES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(savedNotes));
  }, [savedNotes]);

  const handleSaveNote = (subject: Subject, content: string) => {
    const newNote: SavedNote = {
      id: Math.random().toString(36).substr(2, 9),
      subject,
      content,
      timestamp: Date.now()
    };
    setSavedNotes(prev => [newNote, ...prev]);
    triggerNotification("Note Saved to Vault", "success", false);
  };

  const handleDeleteNote = (id: string) => {
    setSavedNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleTimerExpired = () => {
    setTimer(prev => {
      const nextMode = prev.mode === 'study' ? 'break' : 'study';
      const nextTime = nextMode === 'study' ? 25 * 60 : 5 * 60;
      const msg = prev.mode === 'study' ? "Break Protocol Initiated" : "Study Protocol Resumed";
      triggerNotification(msg, 'end', true, true);
      releaseWakeLock();
      return { isActive: false, mode: nextMode, timeLeft: nextTime };
    });
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err: any) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  useEffect(() => {
    if (timer.isActive) {
      workerRef.current?.postMessage({ type: 'START', timeLeft: timer.timeLeft });
      requestWakeLock();
    } else {
      workerRef.current?.postMessage({ type: 'STOP' });
      releaseWakeLock();
    }
  }, [timer.isActive]);

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
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [notification, setNotification] = useState<{message: string, type: 'start' | 'end' | 'success' | 'error' | 'info', persistent?: boolean} | null>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkApiKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success per guidelines
    }
  };
  const [lastNotified, setLastNotified] = useState<Record<string, string>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem(API_KEY_STORAGE, userApiKey);
  }, [userApiKey]);

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
  }, []);

  const requestNotificationPermission = async () => {
    console.log("Requesting notification permission...");
    if ("Notification" in window) {
      try {
        const permission = await Notification.requestPermission();
        console.log("Permission result:", permission);
        setNotificationPermission(permission);
        
        if (permission === 'granted') {
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          triggerNotification("Notifications active! System link verified.", "success", true);
          
          // Try a test notification immediately to confirm
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification('MedQuest AI', {
              body: 'System Link Established',
              icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png'
            });
          }
        } else if (permission === 'denied') {
          triggerNotification("Notifications denied. Please reset permissions in your browser/iOS settings.", 'error', false, true);
        }
      } catch (err) {
        console.error("Error requesting permission:", err);
        triggerNotification("Error requesting notification permission.", 'error', false, true);
      }
    } else {
      // iOS / Safari fallback
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = ((window as any).navigator as any).standalone || (window as any).matchMedia('(display-mode: standalone)').matches;
      
      if (isIOS && !isStandalone) {
        triggerNotification("iOS Alert: Tap 'Share' then 'Add to Home Screen' to enable background notifications.", 'error', false, true);
      } else if (isIOS && isStandalone) {
        triggerNotification("Please enable notifications in your iOS Settings for this app.", 'error', false, true);
      } else {
        triggerNotification("Notifications are not supported on this browser.", 'error', false, true);
      }
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const currentDay = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${h}:${m}`;

      schedules.forEach(schedule => {
        schedule.sessions.forEach(session => {
          if (session.day === currentDay) {
            const startId = `${session.id}-start`;
            const endId = `${session.id}-end`;
            if (session.startTime === currentTimeStr && lastNotified[startId] !== currentTimeStr) {
              triggerNotification(`START: ${session.subject} node!`, 'start', true, true);
              setLastNotified(prev => ({ ...prev, [startId]: currentTimeStr }));
            } else if (session.endTime === currentTimeStr && lastNotified[endId] !== currentTimeStr) {
              triggerNotification(`FINISH: ${session.subject} node!`, 'end', true, true);
              setLastNotified(prev => ({ ...prev, [endId]: currentTimeStr }));
            }
          }
        });
      });
    }, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [schedules, lastNotified]);

  const triggerNotification = async (msg: string, type: 'start' | 'end' | 'success' | 'error' | 'info', system: boolean = false, persistent: boolean = false) => {
    setNotification({ message: msg, type, persistent });
    
    if (system) {
      playNotificationSound(type === 'end' || type === 'start' ? 'alarm' : 'default');
      if (navigator.vibrate) {
        try { navigator.vibrate([200, 100, 200]); } catch (e) {}
      }

      // iOS / Safari check
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = ((window as any).navigator as any).standalone || (window as any).matchMedia('(display-mode: standalone)').matches;

      if (notificationPermission === 'granted') {
        try {
          const options: any = {
            body: msg,
            icon: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/3070/3070044.png',
            vibrate: [200, 100, 200],
            tag: 'medquest-alert-' + (persistent ? 'p' : 't'),
            renotify: true,
            requireInteraction: persistent,
            silent: false
          };

          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            const reg = registrations[0];
            
            if (reg) {
              // On iOS, postMessage is often more reliable than direct showNotification
              // especially when the app is in the background or standalone mode
              if (reg.active) {
                reg.active.postMessage({
                  type: 'SHOW_NOTIFICATION',
                  title: 'MedQuest AI',
                  options
                });
              } else {
                // Fallback to direct if active is not yet set
                await reg.showNotification('MedQuest AI', options);
              }
            } else {
              // No registration found, try to create one or use standard Notification
              new Notification('MedQuest AI', options);
            }
          } else if ('Notification' in window) {
            new Notification('MedQuest AI', options);
          }
        } catch (e) {
          console.error("System notification error:", e);
        }
      } else if (isIOS && !isStandalone) {
        setNotification({ 
          message: "iOS Alert: Tap 'Share' then 'Add to Home Screen' to enable background notifications.", 
          type: 'error', 
          persistent: true 
        });
      }
    }
    
    if (!persistent) {
      setTimeout(() => setNotification(prev => prev?.message === msg ? null : prev), 5000);
    }
  };

  useEffect(() => {
    if (isPiPActive) {
      const updatePiPCanvas = () => {
        const canvas = pipCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw background
        ctx.fillStyle = '#0f172a'; // slate-900
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw Timer
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 60px Inter, sans-serif';
        ctx.textAlign = 'center';
        const minutes = Math.floor(timer.timeLeft / 60);
        const seconds = timer.timeLeft % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        ctx.fillText(timeStr, canvas.width / 2, canvas.height / 2 + 10);

        // Draw Mode/Subject
        ctx.fillStyle = timer.mode === 'study' ? '#3b82f6' : '#10b981';
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.fillText(timer.mode === 'study' ? (activeSubject || 'STUDY') : 'BREAK', canvas.width / 2, canvas.height / 2 + 60);
        
        // Draw Progress Ring (simple)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(canvas.width/2, canvas.height/2, 100, 0, Math.PI * 2);
        ctx.stroke();

        const total = timer.mode === 'study' ? 25 * 60 : 5 * 60;
        const progress = (timer.timeLeft / total);
        ctx.strokeStyle = timer.mode === 'study' ? '#3b82f6' : '#10b981';
        ctx.beginPath();
        ctx.arc(canvas.width/2, canvas.height/2, 100, -Math.PI/2, (-Math.PI/2) + (Math.PI * 2 * progress));
        ctx.stroke();
      };

      const interval = setInterval(updatePiPCanvas, 1000);
      return () => clearInterval(interval);
    }
  }, [isPiPActive, timer, activeSubject]);

  const togglePiP = async () => {
    const video = pipVideoRef.current;
    const canvas = pipCanvasRef.current;
    if (!video || !canvas) return false;

    try {
      const isPipActive = !!document.pictureInPictureElement || (video as any).webkitPresentationMode === 'picture-in-picture';

      if (isPipActive) {
        if (document.exitPictureInPicture) {
          await document.exitPictureInPicture();
        } else if ((video as any).webkitSetPresentationMode) {
          (video as any).webkitSetPresentationMode('inline');
        }
        setIsPiPActive(false);
        return true;
      } else {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (!video.srcObject) {
          video.srcObject = (canvas as any).captureStream(30);
        }
        
        // Safari requires play() to be called immediately in the gesture
        const playPromise = video.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
        
        if (video.requestPictureInPicture) {
          await video.requestPictureInPicture();
        } else if ((video as any).webkitSetPresentationMode) {
          (video as any).webkitSetPresentationMode('picture-in-picture');
        } else {
          return false;
        }
        
        setIsPiPActive(true);
        return true;
      }
    } catch (err) {
      console.error("PiP Error:", err);
      return false;
    }
  };

  const handleMinimize = async () => {
    const success = await togglePiP();
    
    // Fallback: If PiP fails or isn't supported, use the internal Mini Mode
    if (!success) {
      setIsMiniMode(true);
      triggerNotification("System window blocked. Using internal mini-mode instead.", "info");
    }
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
    const responseText = await getTutorResponse(subject, text, chatHistory[subject], userApiKey);
    setIsTyping(false);
    if (responseText) {
      const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', content: responseText, timestamp: Date.now() };
      setChatHistory(prev => ({ ...prev, [subject]: [...prev[subject], modelMsg] }));
      if (isVoiceEnabled) await speakText(responseText, userApiKey);
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
    <div 
      className="flex flex-col h-screen bg-[#0a0a0c] text-slate-200 overflow-hidden font-inter select-none"
      onClick={resumeAudio} // Silently resume audio context on first click
    >
      {(() => {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isStandalone = ((window as any).navigator as any).standalone || (window as any).matchMedia('(display-mode: standalone)').matches;
        
        if (isIOS && !isStandalone) {
          return (
            <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-500 shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-1.5 rounded-lg">
                  <Share size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest">Install Required for Notifications</p>
                  <p className="text-[8px] opacity-80 font-medium">Tap Share then "Add to Home Screen" to enable background alerts.</p>
                </div>
              </div>
            </div>
          );
        }
        return null;
      })()}
      <header className="glass sticky top-0 z-50 px-4 py-3 flex items-center justify-between border-b border-white/5 shadow-2xl safe-top">
        <div className="flex items-center gap-6 cursor-pointer group" onClick={() => setCurrentView(View.MENU)}>
          <motion.div 
            whileHover={{ rotate: 180 }}
            className="bg-blue-600 p-2 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.5)]"
          >
            <BrainCircuit className="text-white" size={20} />
          </motion.div>
          <div className="hidden sm:block text-left">
            <h1 className="text-sm font-display font-black tracking-tighter uppercase text-white leading-none">MedQuest <span className="text-blue-500">OS</span></h1>
            <p className="text-[8px] font-mono font-black uppercase tracking-[0.2em] text-blue-400/60 mt-1">Neural Interface v5.2</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 glass-dark p-1.5 rounded-2xl border border-white/5">
            <NavButton icon={<LayoutDashboard size={16}/>} active={currentView === View.DASHBOARD} onClick={() => activeSchedule ? setCurrentView(View.DASHBOARD) : setCurrentView(View.MENU)} />
            <NavButton icon={<Calendar size={16}/>} active={currentView === View.EDITOR} onClick={() => activeSchedule ? setCurrentView(View.EDITOR) : setCurrentView(View.MENU)} />
            <NavButton icon={<MessageSquare size={16}/>} active={currentView === View.AI_TUTOR} onClick={() => setCurrentView(View.AI_TUTOR)} />
            <NavButton icon={<Bookmark size={16}/>} active={currentView === View.VAULT} onClick={() => setCurrentView(View.VAULT)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button 
              onClick={togglePiP} 
              className={`p-2 rounded-xl transition-all ${isPiPActive ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'}`}
              title="Floating Window"
            >
              <ExternalLink size={16} />
            </button>
            <button 
              onClick={handleMinimize} 
              className="p-2 text-slate-500 hover:bg-white/5 hover:text-slate-200 rounded-xl transition-all"
              title="Minimize"
            >
              <Minimize2 size={16} />
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`p-2 rounded-xl transition-all ${showSettings ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-500 hover:bg-white/5'}`}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      {showSettings && (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-white/10"
          >
            <div className="p-5 border-b border-white/5 flex justify-between items-center bg-white/5">
              <h3 className="text-[10px] font-display font-black uppercase tracking-[0.3em] text-white">System Configuration</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
            </div>
            <div className="p-8 space-y-8 custom-scrollbar max-h-[80vh] overflow-y-auto">
              <div className="space-y-3">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-blue-400 block">Gemini API Key</label>
                <div className="relative">
                  <input 
                    type="password" 
                    placeholder="AIza..." 
                    value={userApiKey} 
                    onChange={(e) => setUserApiKey(e.target.value)}
                    className="w-full bg-white/5 p-4 rounded-2xl border border-white/10 focus:border-blue-500 outline-none font-mono text-xs transition-all text-white placeholder:text-slate-700"
                  />
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed font-medium">
                  Enter your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300 transition-colors">Google AI Studio</a>. 
                  Stored locally. Never transmitted to external servers.
                </p>
              </div>

              <div className="pt-6 border-t border-white/5 space-y-4">
                <h4 className="text-[10px] font-display font-black uppercase tracking-[0.2em] text-white">System Diagnostics</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                    <p className="text-[8px] font-mono font-bold text-slate-500 uppercase mb-1">Architecture</p>
                    <p className="text-[10px] font-bold text-slate-300 truncate">{navigator.platform}</p>
                  </div>
                  <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                    <p className="text-[8px] font-mono font-bold text-slate-500 uppercase mb-1">Standalone</p>
                    <p className="text-[10px] font-bold text-slate-300">{((window as any).navigator as any).standalone || (window as any).matchMedia('(display-mode: standalone)').matches ? 'ACTIVE' : 'OFFLINE'}</p>
                  </div>
                </div>

                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-3">
                  <div className="flex items-center gap-2 text-blue-400">
                    <TestTube size={14} />
                    <span className="text-[9px] font-display font-black uppercase tracking-[0.2em]">Health Report</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-slate-500">Service Worker:</span>
                      <span className={'serviceWorker' in navigator ? 'text-emerald-400' : 'text-red-400'}>{'serviceWorker' in navigator ? 'SYNCED' : 'MISSING'}</span>
                    </div>
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-slate-500">Notification API:</span>
                      <span className={'Notification' in window ? 'text-emerald-400' : 'text-red-400'}>{'Notification' in window ? 'READY' : 'MISSING'}</span>
                    </div>
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-slate-500">Permission:</span>
                      <span className={notificationPermission === 'granted' ? 'text-emerald-400' : 'text-amber-400'}>{notificationPermission.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-600/10 p-4 rounded-2xl border border-blue-500/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-400">
                      <Bell size={16} />
                      <span className="text-[10px] font-display font-black uppercase tracking-widest">Neural Alerts</span>
                    </div>
                    <span className={`text-[8px] font-mono font-black uppercase px-2 py-0.5 rounded ${notificationPermission === 'granted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {notificationPermission === 'granted' ? 'Active' : 'Standby'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={requestNotificationPermission}
                      className="flex-1 bg-white/5 text-blue-400 border border-white/10 py-2.5 rounded-xl font-black uppercase text-[9px] hover:bg-white/10 transition-all"
                    >
                      Auth
                    </button>
                    <button 
                      onClick={() => triggerNotification("Manual Test: Connection Verified", "success", true)}
                      className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-black uppercase text-[9px] hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                    >
                      Test
                    </button>
                  </div>
                </div>
                
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setShowSettings(false)} 
                  className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl shadow-blue-500/20 hover:bg-blue-500 transition-all"
                >
                  Commit Changes
                </button>
                <button 
                  onClick={() => { setUserApiKey(''); localStorage.removeItem(API_KEY_STORAGE); }} 
                  className="px-6 bg-white/5 text-slate-500 py-4 rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-red-500/10 hover:text-red-400 transition-all"
                >
                  Reset
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {notification && (
        <motion.div 
          initial={{ opacity: 0, y: -20, x: 20 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`fixed top-20 right-4 left-4 sm:left-auto z-[100] p-5 rounded-3xl shadow-2xl border border-white/10 glass animate-in slide-in-from-top-4 duration-500 sm:min-w-[320px] ${
            notification.type === 'start' ? 'shadow-blue-500/10' : 
            notification.type === 'end' ? 'shadow-red-500/10' : 
            notification.type === 'success' ? 'shadow-emerald-500/10' : 
            notification.type === 'info' ? 'shadow-blue-400/10' : 'shadow-slate-400/10'
          }`}
        >
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-2xl ${
              notification.type === 'start' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' : 
              notification.type === 'end' ? 'bg-red-600 text-white shadow-lg shadow-red-500/40' : 
              notification.type === 'success' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/40' : 
              notification.type === 'info' ? 'bg-blue-400 text-white shadow-lg shadow-blue-400/40' : 'bg-slate-700 text-white shadow-lg shadow-slate-700/40'
            }`}>
              <Bell size={20} />
            </div>
            <div className="flex-1">
              <h4 className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-slate-500 mb-1.5">System Alert</h4>
              <p className="font-display font-bold text-sm text-white leading-tight">{notification.message}</p>
              {notification.persistent && (
                <button 
                  onClick={() => setNotification(null)} 
                  className="mt-4 w-full bg-blue-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                >
                  Acknowledge
                </button>
              )}
            </div>
            {!notification.persistent && (
              <button onClick={() => setNotification(null)} className="text-slate-600 hover:text-white transition-colors">
                <X size={18}/>
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Hidden elements for PiP - using opacity-[0.001] and 1px size to trick Safari into allowing PiP */}
      <canvas ref={pipCanvasRef} width="256" height="256" className="fixed top-0 left-0 w-px h-px pointer-events-none opacity-[0.001]" />
      <video ref={pipVideoRef} className="fixed top-0 left-0 w-px h-px pointer-events-none opacity-[0.001]" muted playsInline />

      <AnimatePresence>
        {isMiniMode && (
          <motion.div 
            drag
            dragMomentum={false}
            initial={{ scale: 0.8, opacity: 0, x: 20, y: 20 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="fixed bottom-20 right-6 z-[200] w-16 h-16 bg-slate-900 rounded-2xl shadow-2xl flex flex-col items-center justify-center cursor-move border border-slate-700 group"
          >
            <div className="absolute -top-2 -right-2 bg-blue-600 text-white p-1 rounded-full shadow-lg cursor-pointer scale-0 group-hover:scale-100 transition-transform" onClick={() => setIsMiniMode(false)}>
              <Maximize2 size={10} />
            </div>
            <div className="text-[10px] font-black text-white mb-0.5">
              {Math.floor(timer.timeLeft / 60)}:{ (timer.timeLeft % 60).toString().padStart(2, '0') }
            </div>
            <div className={`w-1.5 h-1.5 rounded-full ${timer.mode === 'study' ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
            <div className="text-[6px] text-slate-500 font-bold uppercase mt-1 truncate w-12 text-center">
              {timer.mode === 'study' ? (activeSubject || 'Study') : 'Break'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={`flex-1 overflow-y-auto custom-scrollbar relative ${isMiniMode ? 'blur-sm pointer-events-none opacity-50' : ''}`}>
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
            onDelete={(id) => { if (confirm("Delete this plan?")) { setSchedules(prev => prev.filter(s => s.id !== id)); if (activeScheduleId === id) setActiveScheduleId(null); } }} 
            onTest={() => triggerNotification("System Link Verified - Notification Active", "success", true)} 
          />
        )}
        {currentView === View.DASHBOARD && activeSchedule && (
          <DashboardView schedule={activeSchedule} onGoToEditor={() => setCurrentView(View.EDITOR)} onStartTutor={(s) => { setActiveSubject(s); setCurrentView(View.AI_TUTOR); }} />
        )}
        {currentView === View.EDITOR && activeSchedule && (
          <EditorView schedule={activeSchedule} onAdd={addSessionToActive} onRemove={removeSessionFromActive} />
        )}
        {currentView === View.AI_TUTOR && (
          <TutorView activeSubject={activeSubject} setActiveSubject={setActiveSubject} history={chatHistory} onSend={handleSendMessage} isTyping={isTyping} timer={timer} setTimer={setTimer} onSave={handleSaveNote} />
        )}
        {currentView === View.VAULT && (
          <VaultView notes={savedNotes} onDelete={handleDeleteNote} />
        )}
      </main>
      <div className="safe-bottom bg-slate-50"></div>
    </div>
  );
};

const NavButton: React.FC<{icon: React.ReactNode, active: boolean, onClick: () => void}> = ({icon, active, onClick}) => (
  <motion.button 
    whileHover={{ scale: 1.1, y: -2 }}
    whileTap={{ scale: 0.9 }}
    onClick={onClick} 
    className={`p-2.5 rounded-xl transition-all duration-300 relative group ${
      active 
        ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]' 
        : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    {icon}
    {active && (
      <motion.div 
        layoutId="nav-glow"
        className="absolute inset-0 rounded-xl bg-blue-400/20 blur-xl -z-10"
      />
    )}
  </motion.button>
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
  onTest: () => void
}> = ({schedules, activeId, onSelect, isCreating, setIsCreating, newName, setNewName, onCreate, onDelete, onTest}) => (
  <div className="max-w-5xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
    <div className="flex justify-between items-end mb-10">
      <div>
        <h2 className="text-3xl font-display font-black text-white tracking-tight uppercase">Command Center</h2>
        <p className="text-blue-500/80 text-[10px] font-mono font-bold uppercase tracking-[0.4em] mt-2">System Protocols // Local Storage</p>
      </div>
      <div className="flex gap-4">
        <button onClick={onTest} title="Test Android Notification" className="bg-slate-900/60 backdrop-blur-xl border border-white/10 text-slate-400 px-5 py-3 rounded-2xl hover:text-blue-400 hover:border-blue-500/30 transition-all flex items-center gap-3 shadow-xl">
          <TestTube size={18} /> <span className="text-[10px] font-mono font-bold uppercase tracking-widest hidden sm:inline">Diagnostic</span>
        </button>
        {!isCreating && (
          <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-[11px] flex items-center gap-3 shadow-xl shadow-blue-500/20 uppercase tracking-widest hover:bg-blue-500 transition-all">
            <Plus size={16} /> New Protocol
          </button>
        )}
      </div>
    </div>
    {isCreating && (
      <motion.div 
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="mb-10 bg-slate-900/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-blue-500/30 shadow-2xl shadow-blue-500/10"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-[0.4em]">Protocol Initialization</h3>
          <button onClick={() => setIsCreating(false)} className="text-slate-500 hover:text-white transition-colors bg-white/5 p-2 rounded-xl"><X size={16}/></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onCreate(); }} className="flex gap-4">
          <input 
            autoFocus 
            type="text" 
            placeholder="Enter protocol designation..." 
            value={newName} 
            onChange={(e) => setNewName(e.target.value)} 
            className="flex-1 bg-white/5 p-4 rounded-2xl border border-white/10 font-display font-bold text-sm outline-none focus:border-blue-500 transition-all placeholder:text-slate-600 text-white shadow-inner" 
          />
          <button 
            type="submit" 
            disabled={!newName.trim()} 
            className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest disabled:opacity-30 hover:bg-blue-500 transition-all shadow-xl shadow-blue-500/20"
          >
            Execute
          </button>
        </form>
      </motion.div>
    )}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {schedules.map((s: any) => (
        <motion.div 
          key={s.id} 
          whileHover={{ y: -5, scale: 1.02 }}
          onClick={() => onSelect(s.id)} 
          className={`p-8 rounded-[2.5rem] cursor-pointer border transition-all duration-500 relative overflow-hidden group ${
            activeId === s.id 
              ? 'bg-slate-900/80 backdrop-blur-xl border-blue-500/50 shadow-2xl shadow-blue-500/20' 
              : 'bg-slate-900/40 backdrop-blur-xl border-white/5 hover:border-white/20 shadow-xl'
          }`}
        >
          <div className="flex justify-between items-start mb-8 relative z-10">
            <div className={`p-4 rounded-2xl transition-colors duration-500 ${activeId === s.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' : 'bg-white/5 text-slate-400 group-hover:text-white group-hover:bg-white/10'}`}>
              <Calendar size={24} />
            </div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="p-3 bg-white/5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
              <Trash2 size={16} />
            </button>
          </div>
          <h3 className="text-xl font-display font-black text-white mb-2 relative z-10 tracking-tight">{s.name}</h3>
          <p className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-[0.2em] relative z-10">{s.sessions.length} active nodes</p>
          
          {activeId === s.id && (
            <div className="absolute -right-8 -bottom-8 bg-blue-500/20 w-40 h-40 rounded-full blur-3xl pointer-events-none" />
          )}
        </motion.div>
      ))}
      {schedules.length === 0 && !isCreating && (
        <div className="col-span-full py-24 text-center bg-slate-900/40 backdrop-blur-xl rounded-[3rem] border-dashed border-2 border-white/5 shadow-2xl">
          <div className="bg-white/5 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-slate-600 shadow-inner">
            <Calendar size={48} />
          </div>
          <p className="text-slate-300 text-lg font-display font-black uppercase tracking-widest mb-3">No protocols detected</p>
          <p className="text-slate-500 text-[10px] font-mono font-bold uppercase tracking-[0.3em]">Initialize a new plan to begin system setup</p>
        </div>
      )}
    </div>
    <div className="mt-16 p-8 bg-slate-900/60 backdrop-blur-xl rounded-[2.5rem] border border-blue-500/20 relative overflow-hidden shadow-2xl">
      <div className="flex gap-6 relative z-10">
        <div className="text-blue-400 shrink-0 bg-blue-500/10 p-4 rounded-2xl"><Info size={24} /></div>
        <div className="space-y-3">
          <h4 className="text-[11px] font-display font-black text-blue-400 uppercase tracking-widest">System Optimization</h4>
          <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
            For peak performance and persistent background monitoring, please <strong className="text-blue-300">Install as PWA</strong>. 
            This prevents the OS from suspending the assistant during deep study protocols and ensures real-time neural alerts.
          </p>
        </div>
      </div>
      <div className="absolute -right-10 -top-10 bg-blue-500/5 w-40 h-40 rounded-full blur-3xl" />
    </div>
  </div>
);

const DashboardView: React.FC<{
  schedule: Schedule, 
  onGoToEditor: () => void, 
  onStartTutor: (s: Subject) => void
}> = ({schedule, onGoToEditor, onStartTutor}) => {
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
    <div className="max-w-7xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-slate-900/60 backdrop-blur-xl rounded-[3rem] p-10 text-white relative overflow-hidden shadow-2xl border border-white/10 group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
            <div className="relative z-10">
              <span className="bg-blue-500/20 text-blue-400 px-4 py-1.5 rounded-full text-[10px] font-mono font-bold tracking-[0.3em] uppercase border border-blue-500/20 mb-6 inline-block">{schedule.name}</span>
              <h2 className="text-3xl font-display font-black mb-3 uppercase tracking-tight">{currentSession ? `${currentSession.subject} Active` : "System Standby"}</h2>
              <p className="text-slate-400 text-sm mb-8 font-medium leading-relaxed max-w-md">{currentSession ? `Current task active until ${currentSession.endTime}. Neural pathways optimized for maximum retention.` : "No active protocols scheduled. System in low-power monitoring mode."}</p>
              <div className="flex gap-4">
                {currentSession && (
                  <button onClick={() => onStartTutor(currentSession.subject)} className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 text-xs uppercase tracking-widest shadow-xl shadow-blue-500/20 hover:bg-blue-500 transition-all hover:scale-105 active:scale-95">
                    <Zap size={16} fill="currentColor" /> Neural Tutor
                  </button>
                )}
                <button onClick={onGoToEditor} className="bg-white/5 text-white px-8 py-4 rounded-2xl font-black text-xs border border-white/10 uppercase tracking-widest hover:bg-white/10 transition-all hover:scale-105 active:scale-95">Modify Protocol</button>
              </div>
            </div>
            <BrainCircuit size={160} className="absolute -right-10 -bottom-10 text-blue-500 opacity-10 pointer-events-none group-hover:scale-110 group-hover:rotate-12 transition-all duration-1000" />
          </div>
          <section className="bg-slate-900/40 backdrop-blur-xl p-8 rounded-[3rem] border border-white/5 shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-[0.4em]">Current Sequence — {currentDay}</h3>
              <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-widest">Live Sync</span>
              </div>
            </div>
            <div className="space-y-4">
              {sortedSessions.map((s: any) => (
                <motion.div 
                  key={s.id} 
                  whileHover={{ x: 8, scale: 1.01 }}
                  className="bg-slate-900/60 p-5 rounded-[2rem] border border-white/5 flex items-center justify-between group/item hover:bg-white/10 hover:border-blue-500/30 transition-all cursor-pointer shadow-lg"
                  onClick={() => onStartTutor(s.subject)}
                >
                  <div className="flex items-center gap-6">
                    <div className={`w-14 h-14 rounded-[1.5rem] flex items-center justify-center text-2xl text-white shadow-xl ${SUBJECT_INFO[s.subject as Subject].color} group-hover/item:scale-110 transition-transform duration-500`}>
                      {SUBJECT_INFO[s.subject as Subject].icon}
                    </div>
                    <div>
                      <h4 className="font-display font-black text-lg text-white tracking-tight uppercase">{s.subject}</h4>
                      <p className="text-slate-500 text-[10px] font-mono font-bold uppercase mt-1 tracking-[0.3em]">{s.startTime} — {s.endTime}</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl bg-white/5 text-slate-500 group-hover/item:bg-blue-600 group-hover/item:text-white transition-all shadow-inner">
                    <ChevronRight size={20} />
                  </div>
                </motion.div>
              ))}
              {sortedSessions.length === 0 && (
                <div className="py-16 text-center space-y-4 bg-slate-900/40 rounded-[2.5rem] border border-white/5 border-dashed">
                  <div className="w-16 h-16 rounded-[2rem] bg-white/5 mx-auto flex items-center justify-center text-slate-700 shadow-inner">
                    <Activity size={24} />
                  </div>
                  <p className="text-slate-600 text-[11px] uppercase font-mono font-bold tracking-[0.3em]">No active nodes detected</p>
                </div>
              )}
            </div>
          </section>
        </div>
        <aside className="space-y-8">
          <section className="bg-slate-900/40 backdrop-blur-xl p-8 rounded-[3rem] border border-white/5 shadow-2xl">
            <h4 className="text-[11px] font-mono font-bold mb-8 flex items-center gap-3 text-slate-500 uppercase tracking-[0.4em]">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 shadow-inner"><BookOpen size={16} /></div>
              Neural Nodes
            </h4>
            <div className="grid grid-cols-2 gap-4">
              {SUBJECTS.map(s => (
                <button 
                  key={s} 
                  onClick={() => onStartTutor(s)} 
                  className="flex flex-col items-center gap-4 p-5 rounded-[2rem] bg-slate-900/60 border border-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all group shadow-lg"
                >
                  <span className="text-3xl group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-500">{SUBJECT_INFO[s].icon}</span>
                  <span className="font-display font-black text-white text-[11px] uppercase tracking-widest truncate w-full text-center">{s}</span>
                </button>
              ))}
            </div>
          </section>
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
    <div className="max-w-7xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-slate-900/60 backdrop-blur-xl p-10 rounded-[3rem] border border-white/5 shadow-2xl mb-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
        <h2 className="text-[11px] font-mono font-bold text-slate-500 mb-10 uppercase tracking-[0.4em] flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 shadow-inner"><Settings size={16} /></div>
          Protocol Editor: <span className="text-blue-400">{schedule.name}</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-end relative z-10">
          <div className="space-y-3">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest ml-2">Subject</label>
            <div className="relative">
              <select 
                value={subject} 
                onChange={e => setSubject(e.target.value as Subject)} 
                className="w-full bg-slate-900/80 p-4 rounded-[1.5rem] border border-white/10 font-display font-bold text-sm text-white outline-none appearance-none focus:border-blue-500 transition-all shadow-inner pl-12"
              >
                {SUBJECTS.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
              </select>
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                {SUBJECT_INFO[subject].icon}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest ml-2">Day</label>
            <div className="relative">
              <select 
                value={day} 
                onChange={e => setDay(e.target.value as DayOfWeek)} 
                className="w-full bg-slate-900/80 p-4 rounded-[1.5rem] border border-white/10 font-display font-bold text-sm text-white outline-none appearance-none focus:border-blue-500 transition-all shadow-inner pl-12"
              >
                {DAYS.map(d => <option key={d} value={d} className="bg-slate-900">{d}</option>)}
              </select>
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                <Calendar size={16} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest text-center block">Start</label>
              <input 
                type="time" 
                value={start} 
                onChange={e => setStart(e.target.value)} 
                className="w-full bg-slate-900/80 p-4 rounded-[1.5rem] border border-white/10 font-mono font-bold text-center text-sm text-white outline-none focus:border-blue-500 transition-all shadow-inner" 
              />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest text-center block">End</label>
              <input 
                type="time" 
                value={end} 
                onChange={e => setEnd(e.target.value)} 
                className="w-full bg-slate-900/80 p-4 rounded-[1.5rem] border border-white/10 font-mono font-bold text-center text-sm text-white outline-none focus:border-blue-500 transition-all shadow-inner" 
              />
            </div>
          </div>
          <button 
            onClick={() => onAdd({ subject, day, startTime: start, endTime: end })} 
            className="bg-blue-600 text-white p-4 rounded-[1.5rem] font-black text-xs shadow-xl shadow-blue-500/20 uppercase tracking-widest hover:bg-blue-500 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Add Node
          </button>
        </div>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-xl rounded-[3rem] border border-white/5 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <tbody className="divide-y divide-white/5">
              {DAYS.map(d => (
                <tr key={d} className="group hover:bg-white/5 transition-colors">
                  <td className="px-10 py-8 font-display font-black text-white w-40 align-top uppercase text-[11px] tracking-[0.3em] border-r border-white/5">{d}</td>
                  <td className="px-10 py-8 flex flex-wrap gap-4">
                    {schedule.sessions.filter((s:any) => s.day === d).map((s:any) => (
                      <motion.div 
                        key={s.id} 
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-4 bg-slate-900/80 border border-white/10 px-5 py-3 rounded-[1.5rem] group/item hover:border-blue-500/50 transition-all shadow-lg"
                      >
                        <span className="font-display font-black text-white text-sm uppercase tracking-tight">{s.subject}</span>
                        <span className="text-[10px] font-mono font-bold text-slate-500 tracking-[0.2em]">{s.startTime}</span>
                        <button 
                          onClick={() => onRemove(s.id)} 
                          className="text-slate-600 hover:text-red-400 transition-colors ml-2 bg-white/5 p-1.5 rounded-lg hover:bg-red-500/10"
                        >
                          <X size={14} />
                        </button>
                      </motion.div>
                    ))}
                    {schedule.sessions.filter((s:any) => s.day === d).length === 0 && (
                      <span className="text-slate-700 text-[11px] uppercase font-mono font-bold tracking-[0.4em] py-3">System Idle</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const TutorView: React.FC<{
  activeSubject: Subject | null, 
  setActiveSubject: (s: Subject | null) => void, 
  history: Record<Subject, ChatMessage[]>, 
  onSend: (s: Subject, t: string) => void, 
  isTyping: boolean, 
  timer: TimerState, 
  setTimer: React.Dispatch<React.SetStateAction<TimerState>>,
  onSave: (s: Subject, c: string) => void
}> = ({activeSubject, setActiveSubject, history, onSend, isTyping, timer, setTimer, onSave}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [history, isTyping, activeSubject]);

  if (!activeSubject) {
    return (
      <div className="min-h-full flex flex-col items-center justify-start sm:justify-center p-8 text-center bg-slate-950 overflow-y-auto relative">
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:40px_40px]" />
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-blue-600/10 p-6 rounded-[2.5rem] mb-10 text-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.15)] border border-blue-500/20 animate-pulse mt-8 sm:mt-0 relative z-10"
        >
          <BrainCircuit size={56} />
        </motion.div>
        <h2 className="text-[13px] font-display font-black text-white mb-12 uppercase tracking-[0.6em] relative z-10">Select Neural Interface</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-4xl px-4 pb-12 relative z-10">
          {SUBJECTS.map(s => (
            <motion.button 
              key={s} 
              whileHover={{ scale: 1.05, y: -8 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveSubject(s)} 
              className="bg-slate-900/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/5 hover:border-blue-500/50 hover:bg-white/10 transition-all flex flex-col items-center gap-5 group shadow-2xl"
            >
              <span className="text-5xl group-hover:scale-110 transition-transform duration-500 drop-shadow-2xl">{SUBJECT_INFO[s].icon}</span>
              <span className="font-display font-black text-white text-[11px] tracking-widest uppercase">{s}</span>
            </motion.button>
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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-slate-950 animate-in fade-in duration-700">
      <div className="w-full md:w-80 bg-slate-900/60 backdrop-blur-xl border-r border-white/5 p-8 flex flex-col shrink-0 overflow-y-auto custom-scrollbar max-h-[35vh] md:max-h-full relative z-20 shadow-2xl">
        <div className="flex-1">
          <button onClick={() => setActiveSubject(null as any)} className="mb-10 group p-3 hover:bg-white/5 rounded-2xl transition-all flex items-center gap-3 font-mono font-bold text-slate-500 text-[11px] tracking-[0.3em] uppercase border border-transparent hover:border-white/5">
            <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Disconnect
          </button>
          <div className="mb-12 text-center">
            <div className={`w-24 h-24 rounded-[2rem] mx-auto flex items-center justify-center text-5xl shadow-[0_0_30px_rgba(0,0,0,0.3)] mb-6 ring-1 ring-white/10 ${SUBJECT_INFO[activeSubject as Subject].color} text-white`}>{SUBJECT_INFO[activeSubject as Subject].icon}</div>
            <h3 className="text-2xl font-display font-black text-white uppercase tracking-tight">{activeSubject}</h3>
            <div className="flex items-center justify-center gap-3 mt-4 bg-blue-500/10 py-2 px-4 rounded-full border border-blue-500/20 inline-flex">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
              <p className="text-blue-400 text-[9px] font-mono font-bold uppercase tracking-[0.4em]">Neural Link Active</p>
            </div>
          </div>
          <div className="bg-black/40 p-6 rounded-[2rem] border border-white/5 text-center space-y-6 shadow-inner relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
            <div className="text-4xl font-mono font-black text-white tracking-tighter tabular-nums drop-shadow-lg">{formatTime(timer.timeLeft)}</div>
            <div className="flex justify-center gap-3">
              <button 
                onClick={() => setTimer((t:any) => ({...t, isActive: !t.isActive}))} 
                className={`p-4 rounded-2xl transition-all shadow-xl ${timer.isActive ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-blue-600 text-white shadow-blue-500/20 hover:bg-blue-500 hover:scale-105 active:scale-95'}`}
              >
                {timer.isActive ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <button 
                onClick={() => setTimer((t:any) => ({...t, isActive: false, timeLeft: 25 * 60, mode: 'study'}))} 
                className="p-4 bg-white/5 text-slate-400 rounded-2xl hover:bg-white/10 hover:text-white transition-all border border-transparent hover:border-white/5"
                title="Reset Timer"
              >
                <RotateCcw size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 relative">
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar relative z-10">
          {history[activeSubject].map((msg:any) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-4 duration-500`}>
              <div className={`max-w-[90%] sm:max-w-[85%] rounded-[2rem] px-6 py-5 shadow-2xl relative group ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none shadow-blue-500/20' : 'bg-slate-900/80 backdrop-blur-md border border-white/10 text-slate-200 rounded-tl-none'}`}>
                <div className="leading-relaxed text-[15px] font-medium markdown-body">
                  <ReactMarkdown 
                    remarkPlugins={[remarkMath, remarkGfm]} 
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        if (!inline && match && match[1] === 'chart') {
                          return <ChartRenderer content={String(children).replace(/\n$/, '')} />;
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/5">
                  <div className={`flex items-center gap-2 opacity-40 text-[9px] font-mono font-bold uppercase tracking-widest ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <Clock size={10} /> {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {msg.role === 'model' && (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleCopy(msg.content)} className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all" title="Copy Markdown">
                        <Copy size={16} />
                      </button>
                      <button onClick={() => onSave(activeSubject, msg.content)} className="p-2 hover:bg-blue-500/20 rounded-xl text-blue-400 hover:text-blue-300 transition-all" title="Save to Vault">
                        <Bookmark size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-[2rem] rounded-tl-none px-6 py-5 shadow-2xl flex gap-2 items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0.15s] shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0.3s] shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-6 bg-slate-900/80 backdrop-blur-xl border-t border-white/5 safe-bottom relative z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
           <form className="flex items-center gap-4 bg-black/40 p-2.5 rounded-[2rem] border border-white/10 focus-within:border-blue-500/50 focus-within:bg-white/5 transition-all shadow-inner" 
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isTyping) return;
              onSend(activeSubject, input);
              setInput('');
            }}>
            <input 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              disabled={isTyping} 
              placeholder={`Neural prompt for ${activeSubject}...`} 
              className="flex-1 bg-transparent px-5 py-3 outline-none font-display font-bold text-white placeholder:text-slate-600 disabled:opacity-50 text-[15px]" 
            />
            <button 
              type="submit" 
              disabled={!input.trim() || isTyping} 
              className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all shadow-xl shadow-blue-500/20 active:scale-95 shrink-0"
            >
              <Play size={16} fill="currentColor" />
            </button>
          </form>
          <p className="text-[7px] font-mono font-bold text-slate-700 uppercase tracking-[0.4em] mt-3 text-center">Neural Protocol Synchronized</p>
        </div>
      </div>
    </div>
  );
};

const VaultView: React.FC<{ notes: SavedNote[], onDelete: (id: string) => void }> = ({ notes, onDelete }) => {
  const [selectedNote, setSelectedNote] = useState<SavedNote | null>(null);

  const handleDownload = (note: SavedNote) => {
    const blob = new Blob([note.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Neural_Vault_${note.subject}_${new Date(note.timestamp).toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-700 h-full flex flex-col">
      <div className="flex justify-between items-end mb-10">
        <div>
          <h2 className="text-3xl font-display font-black text-white tracking-tight uppercase">Knowledge Vault</h2>
          <p className="text-slate-500 text-[10px] uppercase font-mono font-bold tracking-[0.4em] mt-2">Stored Intelligence Fragments</p>
        </div>
        <div className="bg-blue-600/10 px-5 py-3 rounded-2xl border border-blue-500/20 shadow-lg">
          <span className="text-[11px] font-mono font-bold text-blue-400 uppercase tracking-widest">{notes.length} Active Nodes</span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-8 min-h-0">
        <div className="md:col-span-1 overflow-y-auto custom-scrollbar space-y-4 pr-4">
          {notes.map(note => (
            <motion.button 
              key={note.id} 
              layoutId={note.id}
              onClick={() => setSelectedNote(note)}
              className={`w-full text-left p-6 rounded-[2.5rem] border transition-all duration-500 group relative shadow-xl ${selectedNote?.id === note.id ? 'bg-blue-600 border-blue-500 text-white shadow-blue-500/30' : 'bg-slate-900/40 backdrop-blur-xl border-white/5 text-slate-400 hover:border-blue-500/30 hover:bg-white/5'}`}
            >
              <div className="flex items-center gap-4 mb-4">
                <span className="text-2xl">{SUBJECT_INFO[note.subject as Subject].icon}</span>
                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.3em] ${selectedNote?.id === note.id ? 'text-blue-100' : 'text-slate-500'}`}>{note.subject}</span>
              </div>
              <p className={`text-xs font-medium line-clamp-2 leading-relaxed ${selectedNote?.id === note.id ? 'text-white' : 'text-slate-300'}`}>
                {note.content.substring(0, 100)}...
              </p>
              <div className={`text-[9px] font-mono font-bold uppercase mt-6 tracking-widest ${selectedNote?.id === note.id ? 'text-blue-200' : 'text-slate-600'}`}>
                {new Date(note.timestamp).toLocaleDateString()}
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); onDelete(note.id); if (selectedNote?.id === note.id) setSelectedNote(null); }}
                className={`absolute top-6 right-6 p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all ${selectedNote?.id === note.id ? 'hover:bg-white/20 text-white' : 'hover:bg-red-500/10 text-slate-600 hover:text-red-400'}`}
              >
                <Trash2 size={16} />
              </button>
            </motion.button>
          ))}
          {notes.length === 0 && (
            <div className="py-24 text-center space-y-6 bg-slate-900/40 backdrop-blur-xl rounded-[3rem] border border-white/5 border-dashed shadow-2xl">
              <div className="w-20 h-20 rounded-[2rem] bg-white/5 mx-auto flex items-center justify-center text-slate-700 shadow-inner">
                <Database size={32} />
              </div>
              <p className="text-slate-500 text-[11px] uppercase font-mono font-bold tracking-[0.4em]">Vault Empty</p>
            </div>
          )}
        </div>

        <div className="md:col-span-2 bg-slate-900/40 backdrop-blur-xl rounded-[3rem] border border-white/5 shadow-2xl overflow-hidden flex flex-col relative">
          {selectedNote ? (
            <>
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-slate-900/60 relative z-10">
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-[1.5rem] flex items-center justify-center text-3xl shadow-xl ${SUBJECT_INFO[selectedNote.subject as Subject].color} text-white`}>
                    {SUBJECT_INFO[selectedNote.subject as Subject].icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-black text-white uppercase tracking-tight">{selectedNote.subject} Analysis</h3>
                    <p className="text-slate-500 text-[10px] font-mono font-bold uppercase tracking-[0.3em] mt-1">{new Date(selectedNote.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => handleDownload(selectedNote)} className="p-4 bg-white/5 border border-white/10 rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 transition-all shadow-xl" title="Download .md">
                    <Download size={18} />
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(selectedNote.content); }} className="p-4 bg-white/5 border border-white/10 rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 transition-all shadow-xl" title="Copy">
                    <Copy size={18} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar relative z-10">
                <div className="markdown-body text-sm leading-relaxed text-slate-300">
                  <ReactMarkdown 
                    remarkPlugins={[remarkMath, remarkGfm]} 
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        if (!inline && match && match[1] === 'chart') {
                          return <ChartRenderer content={String(children).replace(/\n$/, '')} />;
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {selectedNote.content}
                  </ReactMarkdown>
                </div>
              </div>
              <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:32px_32px]" />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-8">
              <div className="w-32 h-32 rounded-[3rem] bg-white/5 flex items-center justify-center text-slate-800 border border-white/5 shadow-inner">
                <Shield size={48} />
              </div>
              <div>
                <h3 className="text-2xl font-display font-black text-white uppercase tracking-tight mb-3">Secure Access Required</h3>
                <p className="text-slate-500 text-xs font-medium max-w-sm mx-auto leading-relaxed">Select a knowledge fragment from the vault to initiate neural reconstruction and access encrypted data.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;