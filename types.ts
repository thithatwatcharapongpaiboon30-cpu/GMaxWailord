
export type Subject = 'Math' | 'Physics' | 'Chemistry' | 'Biology' | 'Social' | 'Thai' | 'TPAT1';

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface StudySession {
  id: string;
  subject: Subject;
  day: DayOfWeek;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
}

export interface Schedule {
  id: string;
  name: string;
  sessions: StudySession[];
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  isAudioPlaying?: boolean;
}

export enum View {
  MENU = 'menu',
  EDITOR = 'editor',
  DASHBOARD = 'dashboard',
  AI_TUTOR = 'ai_tutor'
}

export interface TimerState {
  isActive: boolean;
  timeLeft: number;
  mode: 'study' | 'break';
}
