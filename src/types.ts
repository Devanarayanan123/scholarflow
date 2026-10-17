export interface Question {
  id: string;
  q: string;
  options: string[];
  correctIndex: number;
  points: number;
  explanation: string;
}

export interface Exam {
  id: string;
  code: string;
  title: string;
  subject: string;
  description: string;
  difficulty: 'Foundational' | 'Intermediate' | 'Advanced';
  defaultTimeLimitMinutes: number;
  allowStudentCustomTimer: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showExplanations: boolean;
  createdAt: number;
  questions: Question[];
}

export interface ViolationLog {
  timestamp: number;
  type: 'tab_switch' | 'fullscreen_exit' | 'back_navigation' | 'context_menu' | 'copy_paste_attempt' | 'key_combo' | 'window_blur';
  description: string;
}

export interface SubmissionAnswer {
  questionId: string;
  questionText: string;
  options: string[];
  chosenIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  points: number;
  explanation: string;
}

export interface Submission {
  id: string;
  examCode: string;
  examTitle: string;
  studentName: string;
  studentRoll: string;
  earnedPoints: number;
  totalPoints: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  timeTakenSeconds: number;
  allocatedTimeMinutes: number;
  submittedAt: number;
  autoSubmitted: boolean;
  strikesCount: number;
  integrityStatus: 'Verified Clean' | 'Suspicious Activity' | 'Flagged Disqualified';
  violationLogs: ViolationLog[];
  answers: SubmissionAnswer[];
}
