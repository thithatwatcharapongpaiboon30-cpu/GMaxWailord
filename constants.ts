
import { Subject, DayOfWeek } from './types';

export const SUBJECTS: Subject[] = ['Math', 'Physics', 'Chemistry', 'Biology', 'Social', 'Thai', 'TPAT1'];

export const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SUBJECT_INFO: Record<Subject, { color: string; description: string; icon: string }> = {
  Math: { color: 'bg-blue-500', description: 'Logic, Algebra, Calculus', icon: '📐' },
  Physics: { color: 'bg-indigo-500', description: 'Mechanics, Electricity, Waves', icon: '⚡' },
  Chemistry: { color: 'bg-green-500', description: 'Organic, Inorganic, Stoichiometry', icon: '🧪' },
  Biology: { color: 'bg-emerald-500', description: 'Genetics, Physiology, Botany', icon: '🧬' },
  Social: { color: 'bg-orange-500', description: 'History, Geography, Economics', icon: '🌍' },
  Thai: { color: 'bg-red-500', description: 'Grammar, Literature, Reading', icon: '🇹🇭' },
  TPAT1: { color: 'bg-purple-500', description: 'Medical Aptitude, Ethics', icon: '🩺' },
};

export const SYSTEM_PROMPTS: Record<Subject, string> = {
  Math: "You are a world-class Mathematics tutor specializing in the Thai Medical Entrance Exam (A-Level/TPAT). Focus on problem-solving techniques, shortcuts, and core concepts. Be precise and encouraging.",
  Physics: "You are a Physics expert. Explain complex phenomena simply. Use examples relevant to medical entrance exams. Help students visualize forces and energy.",
  Chemistry: "You are a Chemistry specialist. Help the student master chemical reactions, formulas, and periodic table trends. Focus on both theory and calculation.",
  Biology: "You are a Biology professor. Assist with diagrams, processes, and classification. Connect biological concepts to medical practice where appropriate.",
  Social: "You are a Social Studies expert. Summarize key historical events, geographic facts, and economic principles in a way that is easy to remember for exams.",
  Thai: "You are a master of Thai Language and Literature. Help with reading comprehension, critical analysis, and grammar rules used in standard exams.",
  TPAT1: "You are an expert in Medical Aptitude (TPAT1). Focus on medical ethics, reasoning skills, and the specific format of the TPAT1 exam. Provide ethical dilemmas to practice."
};
