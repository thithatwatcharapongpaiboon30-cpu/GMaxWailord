import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { View, Schedule, Subject, DayOfWeek, StudySession, ChatMessage, TimerState } from './types';
import { SUBJECTS, DAYS, SUBJECT_INFO } from './constants';
import { getTutorResponse, speakText, playNotificationSound, resumeAudio } from './services/geminiService';
import { 
  Plus, Calendar, MessageSquare, Trash2, 
  ChevronLeft, LayoutDashboard, Clock, 
  Settings, Bell, Play, CheckCircle, 
  ChevronRight, BrainCircuit, Volume2, Pause, RotateCcw,
  Zap, BookOpen, X, BellOff, Info, Share, TestTube,
  Maximize2, Minimize2, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const STORAGE_KEY = 'med_quest_v5_schedules';
const ACTIVE_ID_KEY = 'med_quest_v5_active_id';
const API_KEY_STORAGE = 'med_quest_v5_api_key';

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
      className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden font-inter select-none"
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
      <header className="h-12 bg-white/95 border-b px-4 flex items-center justify-between z-50 shrink-0 shadow-sm safe-top">
        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setCurrentView(View.MENU)}>
          <div className="bg-blue-600 p-1 rounded-lg group-hover:scale-105 transition-transform">
            <BrainCircuit className="text-white" size={16} />
          </div>
          <h1 className="text-xs font-black tracking-tight hidden sm:block uppercase">MedQuest AI</h1>
        </div>
        <nav className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <NavButton icon={<LayoutDashboard size={14}/>} active={currentView === View.DASHBOARD} onClick={() => activeSchedule ? setCurrentView(View.DASHBOARD) : setCurrentView(View.MENU)} />
          <NavButton icon={<Calendar size={14}/>} active={currentView === View.EDITOR} onClick={() => activeSchedule ? setCurrentView(View.EDITOR) : setCurrentView(View.MENU)} />
          <NavButton icon={<MessageSquare size={14}/>} active={currentView === View.AI_TUTOR} onClick={() => setCurrentView(View.AI_TUTOR)} />
        </nav>
        <div className="flex items-center gap-0.5">
           <button 
             onClick={togglePiP} 
             className={`p-1.5 rounded-md transition-all ${isPiPActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
             title="Floating Window (Multitasking)"
           >
            <ExternalLink size={16} />
          </button>
           <button 
             onClick={handleMinimize} 
             className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-all"
             title="Minimize App"
           >
            <Minimize2 size={16} />
          </button>
           {!hasApiKey && !userApiKey && (
             <button onClick={handleOpenKeySelector} className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-[8px] font-black uppercase animate-pulse border border-amber-200 mr-1">
               <Zap size={10} fill="currentColor" /> Connect AI
             </button>
           )}
           <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 rounded-md transition-all ${showSettings ? 'bg-slate-200 text-slate-800' : 'text-slate-400'}`}>
            <Settings size={16} />
          </button>
           <button onClick={requestNotificationPermission} className={`p-1.5 rounded-md transition-all ${notificationPermission === 'granted' ? 'text-emerald-500 bg-emerald-50' : 'text-slate-400'}`}>
            {notificationPermission === 'granted' ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
          {notificationPermission === 'granted' && (
            <button 
              onClick={() => triggerNotification("Test Notification Successful!", "success", true)}
              className="p-1.5 text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-all ml-0.5"
              title="Test Notification"
            >
              <TestTube size={16} />
            </button>
          )}
           <button onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} className={`p-1.5 rounded-md transition-all ${isVoiceEnabled ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}>
            <Volume2 size={16} />
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">System Configuration</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Gemini API Key</label>
                <div className="relative">
                  <input 
                    type="password" 
                    placeholder="AIza..." 
                    value={userApiKey} 
                    onChange={(e) => setUserApiKey(e.target.value)}
                    className="w-full bg-slate-50 p-3 rounded-xl border-2 border-slate-100 focus:border-blue-500 outline-none font-mono text-xs transition-all"
                  />
                </div>
                <p className="text-[8px] text-slate-400 leading-relaxed">
                  Enter your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 underline">Google AI Studio</a>. 
                  This key is stored locally on your device and never sent to our servers.
                </p>
              </div>

              <div className="pt-4 border-t space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-800">System Diagnostics</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Platform</p>
                    <p className="text-[9px] font-bold text-slate-700 truncate">{navigator.platform}</p>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <p className="text-[7px] font-black text-slate-400 uppercase mb-1">Standalone</p>
                    <p className="text-[9px] font-bold text-slate-700">{((window as any).navigator as any).standalone || (window as any).matchMedia('(display-mode: standalone)').matches ? 'YES' : 'NO'}</p>
                  </div>
                </div>

                <div className="bg-slate-900 p-3 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-blue-400">
                    <TestTube size={12} />
                    <span className="text-[8px] font-black uppercase tracking-widest">System Health Report</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px]">
                      <span className="text-slate-500">Service Worker:</span>
                      <span className={'serviceWorker' in navigator ? 'text-emerald-400' : 'text-red-400'}>{'serviceWorker' in navigator ? 'SUPPORTED' : 'MISSING'}</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-slate-500">Notification API:</span>
                      <span className={'Notification' in window ? 'text-emerald-400' : 'text-red-400'}>{'Notification' in window ? 'SUPPORTED' : 'MISSING'}</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-slate-500">Current Permission:</span>
                      <span className={notificationPermission === 'granted' ? 'text-emerald-400' : 'text-amber-400'}>{notificationPermission.toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-slate-500">Active Schedule:</span>
                      <span className={activeScheduleId ? 'text-emerald-400' : 'text-slate-400'}>{activeScheduleId ? 'YES' : 'NONE'}</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-slate-500">Sessions Today:</span>
                      <span className="text-blue-400">
                        {(() => {
                          const now = new Date();
                          const currentDay = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
                          const todaySessions = schedules.flatMap(s => s.sessions).filter(sess => sess.day === currentDay);
                          return todaySessions.length;
                        })()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-800">
                      <Bell size={14} />
                      <span className="text-[9px] font-black uppercase tracking-tight">Notification Test Center</span>
                    </div>
                    <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${notificationPermission === 'granted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {notificationPermission === 'granted' ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={requestNotificationPermission}
                      className="flex-1 bg-white text-blue-600 border border-blue-200 py-2 rounded-lg font-black uppercase text-[8px] hover:bg-blue-50 transition-all shadow-sm"
                    >
                      Request Permission
                    </button>
                    <button 
                      onClick={() => triggerNotification("Manual Test: Connection Verified", "success", true)}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-black uppercase text-[8px] hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
                    >
                      Send Test Alert
                    </button>
                  </div>
                </div>
                
                {(() => {
                  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                  if (!isIOS) return null;
                  
                  return (
                    <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 space-y-2">
                      <div className="flex items-center gap-2 text-amber-800">
                        <Info size={14} />
                        <span className="text-[9px] font-black uppercase tracking-tight">iOS Notification Guide</span>
                      </div>
                      <ul className="text-[8px] text-amber-700 space-y-1 ml-4 list-disc">
                        <li>Must be on <strong>iOS 16.4</strong> or newer.</li>
                        <li>Tap <strong>Share</strong> then <strong>"Add to Home Screen"</strong>.</li>
                        <li>Open the app from your <strong>Home Screen</strong>.</li>
                        <li>Go to iOS <strong>Settings &gt; Notifications &gt; MedQuest AI</strong> and ensure "Allow Notifications" is ON.</li>
                        <li>Ensure <strong>Background App Refresh</strong> is enabled in iOS Settings for this app.</li>
                      </ul>
                      <div className="flex gap-2">
                        <button 
                          onClick={requestNotificationPermission}
                          className="flex-1 bg-amber-200 text-amber-800 py-1.5 rounded-lg font-black uppercase text-[8px] hover:bg-amber-300 transition-all"
                        >
                          1. Request Permission
                        </button>
                        <button 
                          onClick={() => triggerNotification("Diagnostic: System Link Active", "success", true)}
                          className="flex-1 bg-amber-600 text-white py-1.5 rounded-lg font-black uppercase text-[8px] hover:bg-amber-700 transition-all shadow-sm"
                        >
                          2. Test iOS Link
                        </button>
                      </div>
                      <button 
                        onClick={async () => {
                          if ('serviceWorker' in navigator) {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            for (let reg of regs) await reg.unregister();
                            window.location.reload();
                          }
                        }}
                        className="w-full border border-amber-200 text-amber-600 py-1 rounded-lg font-black uppercase text-[7px] hover:bg-amber-100 transition-all"
                      >
                        Troubleshoot: Reset System Worker
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setShowSettings(false)} 
                  className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all"
                >
                  Save Configuration
                </button>
                <button 
                  onClick={() => { setUserApiKey(''); localStorage.removeItem(API_KEY_STORAGE); }} 
                  className="px-4 bg-slate-100 text-slate-400 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div className={`fixed top-14 right-4 left-4 sm:left-auto z-[100] p-4 rounded-2xl shadow-2xl border-l-4 bg-white animate-in slide-in-from-top-4 duration-500 sm:min-w-[300px] ${
          notification.type === 'start' ? 'border-blue-600' : 
          notification.type === 'end' ? 'border-red-500' : 
          notification.type === 'success' ? 'border-emerald-500' : 
          notification.type === 'info' ? 'border-blue-400' : 'border-slate-400'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-xl ${
              notification.type === 'start' ? 'bg-blue-50 text-blue-600' : 
              notification.type === 'end' ? 'bg-red-50 text-red-600' : 
              notification.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 
              notification.type === 'info' ? 'bg-blue-50 text-blue-500' : 'bg-slate-50 text-slate-600'
            }`}>
              <Bell size={20} />
            </div>
            <div className="flex-1">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">System Alert</h4>
              <p className="font-bold text-sm text-slate-800 leading-tight">{notification.message}</p>
              {notification.persistent && (
                <button 
                  onClick={() => setNotification(null)} 
                  className="mt-3 w-full bg-slate-900 text-white py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-colors"
                >
                  Acknowledge & Dismiss
                </button>
              )}
            </div>
            {!notification.persistent && (
              <button onClick={() => setNotification(null)} className="text-slate-300 hover:text-slate-500 transition-colors">
                <X size={16}/>
              </button>
            )}
          </div>
        </div>
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
          <MenuView schedules={schedules} activeId={activeScheduleId} onSelect={(id) => { setActiveScheduleId(id); setCurrentView(View.DASHBOARD); }} isCreating={isCreatingSchedule} setIsCreating={setIsCreatingSchedule} newName={newScheduleName} setNewName={setNewScheduleName} onCreate={handleCreateSchedule} onDelete={(id) => { if (confirm("Delete this plan?")) { setSchedules(prev => prev.filter(s => s.id !== id)); if (activeScheduleId === id) setActiveScheduleId(null); } }} onTest={() => triggerNotification("System Link Verified - Notification Active", "success", true)} />
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
  <div className="max-w-4xl mx-auto p-4 animate-in fade-in duration-500">
    <div className="flex justify-between items-end mb-6">
      <div>
        <h2 className="text-xl font-black text-slate-800 tracking-tighter uppercase">Command Center</h2>
        <p className="text-slate-400 text-[9px] uppercase tracking-widest">Protocol Sync</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onTest} title="Test Android Notification" className="bg-slate-200 text-slate-600 p-1.5 rounded-lg hover:bg-slate-300 transition-all flex items-center gap-1">
          <TestTube size={14} /> <span className="text-[8px] font-black uppercase">Test</span>
        </button>
        {!isCreating && (
          <button onClick={() => setIsCreating(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1 shadow-lg shadow-blue-500/10 uppercase">
            <Plus size={12} /> New Plan
          </button>
        )}
      </div>
    </div>
    {isCreating && (
      <div className="mb-6 bg-white p-4 rounded-xl border-2 border-blue-500 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Initialization</h3>
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
        <div key={s.id} onClick={() => onSelect(s.id)} className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${activeId === s.id ? 'bg-white border-blue-500 shadow-md' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
          <div className="flex justify-between items-start mb-3">
            <div className={`p-2 rounded-lg ${activeId === s.id ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}><Calendar size={16} /></div>
            <button onClick={(e) => { e.stopPropagation(); onDelete(s.id); }} className="p-1.5 text-slate-200 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
          <h3 className="text-sm font-black text-slate-800">{s.name}</h3>
          <p className="text-[9px] font-black text-slate-400 mt-1 uppercase tracking-widest">{s.sessions.length} nodes active</p>
        </div>
      ))}
      {schedules.length === 0 && !isCreating && (
        <div className="col-span-full py-12 text-center bg-white rounded-2xl border-2 border-dashed border-slate-200">
          <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
            <Calendar size={32} />
          </div>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">No plans initialized</p>
          <p className="text-slate-300 text-[8px] uppercase tracking-tighter">Click "New Plan" to begin command setup</p>
        </div>
      )}
    </div>
    <div className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100">
      <div className="flex gap-3">
        <div className="text-blue-500 shrink-0"><Info size={18} /></div>
        <div className="space-y-1">
          <h4 className="text-[10px] font-black text-blue-900 uppercase">Android Optimization</h4>
          <p className="text-[9px] text-blue-700 leading-relaxed">For consistent study alerts, please <strong>Install App</strong> (via Chrome Menu &gt; Add to Home Screen). This prevents Android from putting the assistant to sleep during your sessions and allows notifications to work in the background.</p>
        </div>
      </div>
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
    <div className="max-w-5xl mx-auto p-4 animate-in slide-in-from-bottom-2 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 rounded-2xl p-5 text-white relative overflow-hidden shadow-xl">
            <div className="relative z-10">
              <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full text-[8px] font-black tracking-widest uppercase border border-white/5 mb-3 inline-block">{schedule.name}</span>
              <h2 className="text-lg font-black mb-1 uppercase tracking-tight">{currentSession ? `${currentSession.subject} Active` : "System Standby"}</h2>
              <p className="text-slate-400 text-[10px] mb-4">{currentSession ? `Current task active until ${currentSession.endTime}.` : "No active protocols scheduled."}</p>
              <div className="flex gap-2">
                {currentSession && (
                  <button onClick={() => onStartTutor(currentSession.subject)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 text-[10px] uppercase">
                    <Zap size={12} fill="currentColor" /> Neural Tutor
                  </button>
                )}
                <button onClick={onGoToEditor} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg font-bold text-[10px] border border-white/5 uppercase">Modify</button>
              </div>
            </div>
            <BrainCircuit size={60} className="absolute -right-4 -bottom-4 text-white opacity-5 pointer-events-none" />
          </div>
          <section>
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Today's Sequence — {currentDay}</h3>
            <div className="space-y-2">
              {sortedSessions.map((s: any) => (
                <div key={s.id} className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between shadow-sm group hover:border-blue-400 transition-all">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm text-white shadow-sm ${SUBJECT_INFO[s.subject as Subject].color}`}>{SUBJECT_INFO[s.subject as Subject].icon}</div>
                    <div>
                      <h4 className="font-bold text-[11px] text-slate-800">{s.subject}</h4>
                      <p className="text-slate-400 text-[8px] font-black uppercase">{s.startTime} — {s.endTime}</p>
                    </div>
                  </div>
                  <button onClick={() => onStartTutor(s.subject)} className="p-1.5 rounded-lg bg-slate-50 text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition-all"><ChevronRight size={14} /></button>
                </div>
              ))}
              {sortedSessions.length === 0 && <p className="text-slate-300 text-[9px] text-center py-4 uppercase font-black">No nodes scheduled</p>}
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-md">
            <h4 className="text-[9px] font-black mb-3 flex items-center gap-2 text-slate-400 uppercase tracking-widest"><BookOpen size={12} className="text-blue-500" /> Subject Nodes</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {SUBJECTS.map(s => (
                <button key={s} onClick={() => onStartTutor(s)} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition-all text-left">
                  <span className="text-sm">{SUBJECT_INFO[s].icon}</span>
                  <span className="font-bold text-slate-700 text-[9px] truncate">{s}</span>
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
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-md mb-4">
        <h2 className="text-xs font-black text-slate-800 mb-4 uppercase tracking-widest">Protocol Editor: {schedule.name}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <label className="text-[8px] font-black text-slate-400 uppercase ml-1">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value as Subject)} className="w-full bg-slate-50 p-1.5 rounded-lg border-none font-bold text-xs outline-none appearance-none">
              {SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[8px] font-black text-slate-400 uppercase ml-1">Day</label>
            <select value={day} onChange={e => setDay(e.target.value as DayOfWeek)} className="w-full bg-slate-50 p-1.5 rounded-lg border-none font-bold text-xs outline-none appearance-none">
              {DAYS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase text-center block">Start</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)} className="w-full bg-slate-50 p-1.5 rounded-lg border-none font-bold text-center text-xs outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase text-center block">End</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="w-full bg-slate-50 p-1.5 rounded-lg border-none font-bold text-center text-xs outline-none" />
            </div>
          </div>
          <button onClick={() => onAdd({ subject, day, startTime: start, endTime: end })} className="bg-blue-600 text-white p-2 rounded-lg font-bold text-[10px] shadow-sm uppercase">Add Node</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <tbody className="divide-y divide-slate-100">
            {DAYS.map(d => (
              <tr key={d} className="group hover:bg-slate-50/50">
                <td className="px-3 py-2.5 font-black text-slate-800 w-20 align-top uppercase text-[9px] tracking-tighter">{d}</td>
                <td className="px-3 py-2.5 flex flex-wrap gap-1">
                  {schedule.sessions.filter((s:any) => s.day === d).map((s:any) => (
                    <div key={s.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                      <span className="font-bold text-slate-700 text-[9px]">{s.subject}</span>
                      <span className="text-[7px] text-slate-400">{s.startTime}</span>
                      <button onClick={() => onRemove(s.id)} className="text-slate-300 hover:text-red-500"><X size={10} /></button>
                    </div>
                  ))}
                  {schedule.sessions.filter((s:any) => s.day === d).length === 0 && (
                    <span className="text-slate-300 text-[8px] uppercase font-bold italic py-1">Idle</span>
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
  setActiveSubject: (s: Subject | null) => void, 
  history: Record<Subject, ChatMessage[]>, 
  onSend: (s: Subject, t: string) => void, 
  isTyping: boolean, 
  timer: TimerState, 
  setTimer: React.Dispatch<React.SetStateAction<TimerState>>
}> = ({activeSubject, setActiveSubject, history, onSend, isTyping, timer, setTimer}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [history, isTyping, activeSubject]);

  if (!activeSubject) {
    return (
      <div className="min-h-full flex flex-col items-center justify-start sm:justify-center p-6 text-center bg-white overflow-y-auto">
        <div className="bg-slate-900 p-3 rounded-xl mb-4 text-blue-500 shadow-md animate-pulse mt-8 sm:mt-0"><BrainCircuit size={28} /></div>
        <h2 className="text-[10px] font-black text-slate-800 mb-5 uppercase tracking-widest">Select AI Specialist</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl px-2 pb-12">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => setActiveSubject(s)} className="bg-white p-4 rounded-xl border border-slate-100 hover:border-blue-500 hover:shadow-lg transition-all flex flex-col items-center gap-2 group active:scale-95">
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
    <div className="h-full flex flex-col md:flex-row bg-white animate-in zoom-in-95 duration-500">
      <div className="w-full md:w-48 bg-slate-50 border-r border-slate-100 p-4 flex flex-col shrink-0 overflow-y-auto custom-scrollbar max-h-[30vh] md:max-h-full">
        <div>
          <button onClick={() => setActiveSubject(null as any)} className="mb-4 group p-1 hover:bg-slate-200 rounded-md transition-all flex items-center gap-1.5 font-black text-slate-400 text-[8px] tracking-widest uppercase">
            <ChevronLeft size={10} /> Back
          </button>
          <div className="mb-5 text-center">
            <div className={`w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-xl shadow-sm mb-2 ring-1 ring-white ${SUBJECT_INFO[activeSubject as Subject].color} text-white`}>{SUBJECT_INFO[activeSubject as Subject].icon}</div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tighter">{activeSubject}</h3>
            <p className="text-blue-500 text-[6px] font-black uppercase tracking-widest mt-0.5 opacity-40">Active Link</p>
          </div>
          <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-100 text-center space-y-1.5">
            <div className="text-lg font-black text-slate-900 tracking-tighter tabular-nums">{formatTime(timer.timeLeft)}</div>
            <div className="flex justify-center gap-1">
              <button onClick={() => setTimer((t:any) => ({...t, isActive: !t.isActive}))} className={`p-1 rounded-md transition-all ${timer.isActive ? 'bg-slate-900 text-white' : 'bg-blue-600 text-white shadow-blue-500/20 shadow'}`}>
                {timer.isActive ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              </button>
              <button onClick={() => setTimer((t:any) => ({...t, isActive: false, timeLeft: 25 * 60, mode: 'study'}))} className="p-1 bg-slate-100 text-slate-400 rounded-md hover:bg-slate-200"><RotateCcw size={12} /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar bg-[radial-gradient(#f1f5f9_1px,transparent_1px)] [background-size:12px_12px]">
          {history[activeSubject].map((msg:any) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-1 duration-200`}>
              <div className={`max-w-[90%] sm:max-w-[80%] rounded-lg px-2.5 py-1.5 shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none shadow-blue-500/10' : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'}`}>
                <div className="leading-relaxed text-[11px] font-medium markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
                <div className={`flex items-center gap-1 mt-1 opacity-20 text-[5px] font-black uppercase ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}><Clock size={5} /> {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-slate-100 border border-slate-200 rounded-lg rounded-tl-none px-2 py-1 shadow-sm flex gap-0.5">
                <div className="w-0.5 h-0.5 bg-blue-300 rounded-full animate-bounce"></div>
                <div className="w-0.5 h-0.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.1s]"></div>
                <div className="w-0.5 h-0.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-2 bg-white/95 border-t border-slate-100 safe-bottom">
           <form className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 focus-within:border-blue-400 focus-within:bg-white transition-all shadow-sm" 
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isTyping) return;
              onSend(activeSubject, input);
              setInput('');
            }}>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} disabled={isTyping} placeholder={`Neural prompt for ${activeSubject}...`} className="flex-1 bg-transparent px-2 py-1 outline-none font-bold text-slate-800 placeholder:text-slate-300 disabled:opacity-50 text-[11px]" />
            <button type="submit" disabled={!input.trim() || isTyping} className="bg-blue-600 text-white p-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md active:scale-95 shrink-0">
              <Play size={12} fill="currentColor" />
            </button>
          </form>
          <p className="text-[5px] font-black text-slate-200 uppercase tracking-widest mt-1 text-center">Protocol Synchronized</p>
        </div>
      </div>
    </div>
  );
};

export default App;