import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Trash2,
  Share2,
  Check,
  Download,
  BarChart3,
  ExternalLink,
  Sparkles,
  Search,
  Award,
  Users,
  TrendingUp,
  GraduationCap,
  Clock,
  QrCode,
  Layers,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileCheck2
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { Exam, Submission } from '../types';
import { TeacherProfile } from '../utils/api';
import { copyTextToClipboard, formatTime, getExamShareUrl } from '../utils/helpers';
import { GeminiQuizGenerator } from './GeminiQuizGenerator';
import { ShareExamModal } from './ShareExamModal';

interface TeacherDashboardProps {
  teacher: TeacherProfile;
  exams: Exam[];
  submissions: Submission[];
  isRefreshing: boolean;
  onRefreshResults: () => void;
  onSaveExam: (exam: Exam) => void;
  onExamGenerated: (exam: Exam) => void;
  onDeleteExam: (examCode: string) => void;
  onDeleteSubmission: (id: string) => void;
  onLogout: () => void;
  onPreviewExam: (examCode: string) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  teacher,
  exams,
  submissions,
  isRefreshing,
  onRefreshResults,
  onSaveExam,
  onExamGenerated,
  onDeleteExam,
  onDeleteSubmission,
  onLogout,
  onPreviewExam,
  onShowToast
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'quizzes' | 'scores'>('create');
  const [shareExamTarget, setShareExamTarget] = useState<Exam | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [quizFilter, setQuizFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'recent' | 'score_desc' | 'time_asc'>('recent');

  // Expanded student submission ID to inspect which questions the student got right and wrong
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<string | null>(null);

  // Interactive Quiz Inspector & Custom Question Form State
  const [expandedExamCode, setExpandedExamCode] = useState<string | null>(null);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptions, setNewOptions] = useState<string[]>(['', '', '', '']);
  const [newCorrectIndex, setNewCorrectIndex] = useState<number>(0);
  const [newExplanation, setNewExplanation] = useState('');
  const [questionFormError, setQuestionFormError] = useState('');

  // Direct 1-Click student link copy
  const handleQuickCopyLink = (exam: Exam) => {
    const url = getExamShareUrl(exam.code);
    copyTextToClipboard(url);
    setCopiedCode(exam.code);
    onShowToast(`Copied student link for ${exam.code}!`);
    setTimeout(() => setCopiedCode((prev) => (prev === exam.code ? null : prev)), 2000);
  };

  // Update Examiner Time Limit dynamically on a published quiz
  const handleUpdateTimeLimit = (exam: Exam, newMinutes: number) => {
    const updated: Exam = {
      ...exam,
      defaultTimeLimitMinutes: newMinutes
    };
    onSaveExam(updated);
    onShowToast(`Updated ${exam.code} official timer to ${newMinutes} mins`);
  };

  // Add a custom validated question to an existing quiz
  const handleAddCustomQuestion = (e: React.FormEvent, exam: Exam) => {
    e.preventDefault();
    if (newQuestionText.trim().length < 8) {
      setQuestionFormError('Question prompt must be at least 8 characters long.');
      return;
    }
    const trimmedOpts = newOptions.map((o) => o.trim());
    if (trimmedOpts.some((o) => !o)) {
      setQuestionFormError('Please fill in all 4 answer choices (A, B, C, and D).');
      return;
    }

    setQuestionFormError('');
    const updated: Exam = {
      ...exam,
      questions: [
        ...exam.questions,
        {
          id: `custom_q_${Date.now()}`,
          q: newQuestionText.trim(),
          options: trimmedOpts,
          correctIndex: newCorrectIndex,
          points: 2,
          explanation: newExplanation.trim() || 'Verified examiner solution.'
        }
      ]
    };

    onSaveExam(updated);
    setNewQuestionText('');
    setNewOptions(['', '', '', '']);
    setNewCorrectIndex(0);
    setNewExplanation('');
    onShowToast(`Added new question to ${exam.code}!`);
  };

  // Delete a single question from a quiz
  const handleDeleteQuestion = (exam: Exam, qId: string) => {
    if (exam.questions.length <= 1) {
      onShowToast('A quiz must retain at least 1 question.', 'error');
      return;
    }
    const updated: Exam = {
      ...exam,
      questions: exam.questions.filter((q) => q.id !== qId)
    };
    onSaveExam(updated);
    onShowToast(`Removed question from ${exam.code}`);
  };

  // Recharts: Average student performance across all exams (scores bar chart)
  const performanceChartData = useMemo(() => {
    return exams.map((ex) => {
      const examSubs = submissions.filter((s) => s.examCode === ex.code);
      if (examSubs.length === 0) {
        return {
          code: ex.code,
          title: ex.title,
          avgScore: 0,
          highestScore: 0,
          submissionsCount: 0
        };
      }
      const totalScore = examSubs.reduce((acc, curr) => acc + curr.percentage, 0);
      const maxScore = Math.max(...examSubs.map((s) => s.percentage));
      return {
        code: ex.code,
        title: ex.title,
        avgScore: Math.round(totalScore / examSubs.length),
        highestScore: maxScore,
        submissionsCount: examSubs.length
      };
    });
  }, [exams, submissions]);

  // Overall Aggregate Statistics
  const overallStats = useMemo(() => {
    if (submissions.length === 0) {
      return {
        classAverage: 0,
        totalSubmissions: 0,
        topExamName: 'None yet',
        topExamScore: 0
      };
    }
    const sum = submissions.reduce((acc, s) => acc + s.percentage, 0);
    const avg = Math.round(sum / submissions.length);

    let highestAvg = -1;
    let highestExam = 'None';
    performanceChartData.forEach((item) => {
      if (item.submissionsCount > 0 && item.avgScore > highestAvg) {
        highestAvg = item.avgScore;
        highestExam = `${item.code} (${item.avgScore}%)`;
      }
    });

    return {
      classAverage: avg,
      totalSubmissions: submissions.length,
      topExamName: highestExam,
      topExamScore: highestAvg
    };
  }, [submissions, performanceChartData]);

  // CSV Export including Correct/Wrong counts
  const handleExportCSV = () => {
    if (submissions.length === 0) {
      onShowToast('No student submissions to export yet.', 'error');
      return;
    }

    const headers = [
      'Student Name',
      'Roll Number',
      'Exam Code',
      'Score',
      'Total Points',
      'Percentage (%)',
      'Correct Questions',
      'Wrong Questions',
      'Unanswered Questions',
      'Time Taken'
    ];
    const rows = submissions.map((s) => [
      `"${s.studentName.replace(/"/g, '""')}"`,
      `"${s.studentRoll.replace(/"/g, '""')}"`,
      `"${s.examCode}"`,
      s.earnedPoints,
      s.totalPoints,
      `${s.percentage}%`,
      s.correctCount,
      s.wrongCount,
      s.skippedCount,
      formatTime(s.timeTakenSeconds)
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `student_scores_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onShowToast('Student scores CSV downloaded!');
  };

  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = submissions.filter((s) => {
      const matchesQuiz = quizFilter === 'ALL' || s.examCode === quizFilter;
      const matchesQuery =
        !q ||
        s.studentName.toLowerCase().includes(q) ||
        s.studentRoll.toLowerCase().includes(q) ||
        s.examCode.toLowerCase().includes(q);
      return matchesQuiz && matchesQuery;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'score_desc') return b.percentage - a.percentage;
      if (sortBy === 'time_asc') return a.timeTakenSeconds - b.timeTakenSeconds;
      return b.submittedAt - a.submittedAt;
    });
  }, [submissions, searchQuery, quizFilter, sortBy]);

  // Per-question class accuracy breakdown (how many students got each question right vs wrong)
  const questionAccuracyStats = useMemo(() => {
    const targetExam =
      quizFilter !== 'ALL' ? exams.find((e) => e.code === quizFilter) : exams[0];
    if (!targetExam) return null;

    const examSubs = submissions.filter((s) => s.examCode === targetExam.code);
    if (examSubs.length === 0) return null;

    const stats = targetExam.questions.map((q, idx) => {
      let correct = 0;
      let wrong = 0;
      let skipped = 0;
      examSubs.forEach((sub) => {
        const ans = sub.answers.find((a) => a.questionId === q.id) || sub.answers[idx];
        if (!ans || ans.chosenIndex < 0) skipped++;
        else if (ans.isCorrect) correct++;
        else wrong++;
      });
      return {
        index: idx + 1,
        questionText: q.q,
        correctAnswer: q.options[q.correctIndex],
        correct,
        wrong,
        skipped,
        total: examSubs.length,
        accuracyPercent: Math.round((correct / examSubs.length) * 100)
      };
    });

    return {
      exam: targetExam,
      totalStudents: examSubs.length,
      questions: stats
    };
  }, [exams, submissions, quizFilter]);

  return (
    <div className="w-full space-y-6 sm:space-y-8">
      {/* Teacher Identity & Actions Header Card */}
      <div className="relative overflow-hidden bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-md">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.34 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.98 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display font-bold text-white text-base sm:text-lg tracking-tight truncate">
                {teacher.name || teacher.email}
              </h1>
              <span className="text-xs font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-full truncate">
                {teacher.email}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {teacher.institution || 'Verified Teacher Account · Gemini AI Connected'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={onRefreshResults}
            disabled={isRefreshing}
            className="px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 active:scale-[0.98] text-xs font-semibold text-slate-200 flex items-center gap-1.5 border border-slate-700/80 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Scores</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] border border-rose-500/20 text-xs font-semibold text-rose-300 transition"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Responsive Primary Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-slate-800/90 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('create')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
            activeTab === 'create'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:bg-slate-900 border border-slate-800/80'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Create Quiz (Gemini AI)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('quizzes')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
            activeTab === 'quizzes'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:bg-slate-900 border border-slate-800/80'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Published Quizzes</span>
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-[11px] ${
              activeTab === 'quizzes'
                ? 'bg-indigo-500/40 text-white'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {exams.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('scores')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
            activeTab === 'scores'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-100 hover:bg-slate-900 border border-slate-800/80'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>Student Scores &amp; Answers</span>
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-[11px] ${
              activeTab === 'scores'
                ? 'bg-indigo-500/40 text-white'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {submissions.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CREATE QUIZ WITH GEMINI */}
      {activeTab === 'create' && (
        <GeminiQuizGenerator
          teacherEmail={teacher.email}
          teacherName={teacher.name}
          onExamGenerated={(newExam) => {
            onExamGenerated(newExam);
            setActiveTab('quizzes');
          }}
          onShowToast={onShowToast}
        />
      )}

      {/* TAB 2: PUBLISHED QUIZZES */}
      {activeTab === 'quizzes' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base sm:text-lg font-display font-bold text-white tracking-tight">
                Published Quizzes ({exams.length})
              </h3>
              <p className="text-xs text-slate-400">
                Share direct join links with students, edit questions, or view student scores
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className="px-3.5 py-2 rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-xs text-indigo-300 font-semibold flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Create New Quiz</span>
            </button>
          </div>

          {exams.length === 0 ? (
            <div className="p-8 text-center space-y-3 bg-slate-900/90 border border-slate-800/90 rounded-2xl">
              <p className="text-sm font-semibold text-slate-300">No quizzes created yet</p>
              <p className="text-xs text-slate-400">
                Use the Gemini AI Quiz Generator to create your first quiz and share the link with your students.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Go to Quiz Generator</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              {exams.map((ex) => {
                const subCount = submissions.filter((s) => s.examCode === ex.code).length;
                const isCopied = copiedCode === ex.code;

                return (
                  <div
                    key={ex.code}
                    className="group p-5 sm:p-6 rounded-2xl bg-slate-900/90 border border-slate-800/90 hover:border-slate-700/90 flex flex-col justify-between gap-4 shadow-lg transition-all duration-200"
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/15 border border-indigo-500/25 px-2.5 py-1 rounded-lg">
                            {ex.code}
                          </span>
                          {ex.difficulty && (
                            <span className="text-[11px] font-medium text-slate-300 bg-slate-800/90 px-2.5 py-0.5 rounded-lg border border-slate-700/60">
                              {ex.difficulty}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                          <span className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                            <Layers className="w-3 h-3 text-indigo-400" />
                            {ex.questions.length} Qs
                          </span>
                          <span className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 font-mono text-amber-300">
                            <Clock className="w-3 h-3 text-amber-400" />
                            {ex.defaultTimeLimitMinutes}m
                          </span>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-display font-bold text-base text-white leading-snug">
                          {ex.title}
                        </h4>
                        <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                          {ex.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleQuickCopyLink(ex)}
                        className={`flex-1 py-2 px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.98] ${
                          isCopied
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                        }`}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                        <span>{isCopied ? 'Link Copied!' : 'Copy Student Link'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShareExamTarget(ex)}
                        className="py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-semibold text-slate-200 flex items-center gap-1 transition"
                        title="QR Code & Invite Options"
                      >
                        <QrCode className="w-3.5 h-3.5 text-amber-400" />
                        <span>Share</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setExpandedExamCode((prev) => (prev === ex.code ? null : ex.code));
                          setQuestionFormError('');
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1 transition ${
                          expandedExamCode === ex.code
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                            : 'bg-slate-800/90 hover:bg-slate-700 border-slate-700/70 text-slate-200'
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{expandedExamCode === ex.code ? 'Close' : 'Questions'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onPreviewExam(ex.code)}
                        className="py-2 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-semibold text-slate-200 flex items-center gap-1 transition"
                        title="Open Student Quiz Link in New Tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteExam(ex.code)}
                        className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition"
                        title="Delete Quiz"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Direct shortcut to view student scores & right/wrong answers for this quiz */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <span className="text-slate-400">
                        <strong className="text-white">{subCount}</strong> student submission{subCount === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setQuizFilter(ex.code);
                          setActiveTab('scores');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                      >
                        <span>View Student Scores &amp; Answers →</span>
                      </button>
                    </div>

                    {/* Expandable Question Inspector & Custom Question Builder */}
                    {expandedExamCode === ex.code && (
                      <div className="pt-4 mt-1 border-t border-slate-800 space-y-4 animate-in fade-in duration-200">
                        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>Examiner Time Limit (Fixed for Students):</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {[5, 10, 15, 20, 30, 45, 60].map((mins) => (
                              <button
                                key={mins}
                                type="button"
                                onClick={() => handleUpdateTimeLimit(ex, mins)}
                                className={`px-2 py-1 rounded-lg font-mono text-[11px] font-bold transition ${
                                  ex.defaultTimeLimitMinutes === mins
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                                }`}
                              >
                                {mins}m
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {ex.questions.map((qItem, qIdx) => (
                            <div
                              key={qItem.id}
                              className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 flex items-start justify-between gap-2.5 text-xs"
                            >
                              <div className="space-y-1 min-w-0">
                                <p className="font-semibold text-slate-200">
                                  Q{qIdx + 1}. {qItem.q}
                                </p>
                                <p className="text-[11px] text-emerald-400">
                                  Correct Answer: {qItem.options[qItem.correctIndex]}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteQuestion(ex, qItem.id)}
                                className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                                title="Remove Question"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>

                        <form
                          onSubmit={(e) => handleAddCustomQuestion(e, ex)}
                          className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                        >
                          <span className="text-xs font-bold text-indigo-300 block">
                            + Add Custom Question to {ex.code}
                          </span>
                          <input
                            type="text"
                            value={newQuestionText}
                            onChange={(e) => {
                              setNewQuestionText(e.target.value);
                              if (questionFormError) setQuestionFormError('');
                            }}
                            placeholder="Enter question text"
                            className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {newOptions.map((optVal, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setNewCorrectIndex(optIdx)}
                                  className={`w-6 h-6 rounded-md font-mono text-[11px] font-bold shrink-0 ${
                                    newCorrectIndex === optIdx
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                  title="Click to mark as Correct Answer"
                                >
                                  {['A', 'B', 'C', 'D'][optIdx]}
                                </button>
                                <input
                                  type="text"
                                  value={optVal}
                                  onChange={(e) => {
                                    const copy = [...newOptions];
                                    copy[optIdx] = e.target.value;
                                    setNewOptions(copy);
                                    if (questionFormError) setQuestionFormError('');
                                  }}
                                  placeholder={`Option ${['A', 'B', 'C', 'D'][optIdx]}${
                                    newCorrectIndex === optIdx ? ' (Correct)' : ''
                                  }`}
                                  className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none"
                                />
                              </div>
                            ))}
                          </div>
                          {questionFormError && (
                            <p className="text-[11px] text-rose-400 font-medium">{questionFormError}</p>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-500">
                              Click A/B/C/D badge to select the correct answer
                            </span>
                            <button
                              type="submit"
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
                            >
                              Add Question
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: STUDENT SCORES, QUESTION-BY-QUESTION CORRECT/WRONG REVIEW & ANALYTICS */}
      {activeTab === 'scores' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Key Metric Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900/90 border border-slate-800/90 p-5 rounded-2xl shadow-lg space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Class Average</span>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-display font-bold font-mono text-emerald-400">
                {overallStats.classAverage}%
              </div>
              <p className="text-xs text-slate-400">Average score across all submissions</p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/90 p-5 rounded-2xl shadow-lg space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Student Submissions</span>
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-display font-bold font-mono text-white">
                {overallStats.totalSubmissions}
              </div>
              <p className="text-xs text-slate-400">Completed student quizzes</p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/90 p-5 rounded-2xl shadow-lg space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Top Performing Quiz</span>
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <div className="text-lg sm:text-xl font-display font-bold font-mono text-amber-300 truncate">
                {overallStats.topExamName}
              </div>
              <p className="text-xs text-slate-400">Highest average score</p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800/90 p-5 rounded-2xl shadow-lg space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Published Quizzes</span>
                <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                  <GraduationCap className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-display font-bold font-mono text-white">
                {exams.length}
              </div>
              <p className="text-xs text-slate-400">Active assessments</p>
            </div>
          </div>

          {/* INDIVIDUAL STUDENT SCORES & DETAILED QUESTION-BY-QUESTION RIGHT/WRONG REVIEW */}
          <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/90 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-display font-bold text-white flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-emerald-400" />
                  <span>Student Scores &amp; Question-by-Question Answer Breakdown ({filteredSubmissions.length})</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Click &quot;View Correct &amp; Wrong Answers&quot; on any student to see every question they answered right or wrong
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 sm:w-52 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search student or Roll ID..."
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                  />
                </div>

                <select
                  value={quizFilter}
                  onChange={(e) => setQuizFilter(e.target.value)}
                  className="rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="ALL">All Quizzes</option>
                  {exams.map((ex) => (
                    <option key={ex.code} value={ex.code}>
                      {ex.code} — {ex.title}
                    </option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="recent">Sort: Most Recent</option>
                  <option value="score_desc">Sort: Highest Score</option>
                  <option value="time_asc">Sort: Fastest Time</option>
                </select>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 shrink-0 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {filteredSubmissions.length === 0 ? (
              <div className="py-10 text-center space-y-2 bg-slate-950/60 rounded-xl border border-slate-800/70">
                <p className="text-sm font-semibold text-slate-300">No student submissions recorded yet</p>
                <p className="text-xs text-slate-500">
                  When students complete a quiz via your shared link, their scores and question-by-question answers will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSubmissions.map((s) => {
                  const isExpanded = expandedSubmissionId === s.id;
                  return (
                    <div
                      key={s.id}
                      className="rounded-2xl bg-slate-950/90 border border-slate-800/90 overflow-hidden transition-all"
                    >
                      {/* Student Summary Row */}
                      <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-display font-bold text-white text-sm sm:text-base">
                              {s.studentName}
                            </span>
                            <span className="font-mono text-xs text-slate-300 bg-slate-900 border border-slate-800 px-2.5 py-0.5 rounded-md">
                              ID: {s.studentRoll}
                            </span>
                            <span className="font-mono text-xs font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-0.5 rounded-md">
                              {s.examCode}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            {s.examTitle} · Time taken: <span className="font-mono text-slate-300">{formatTime(s.timeTakenSeconds)}</span>
                          </p>
                        </div>

                        {/* Score + Right / Wrong Badges + Expand Button */}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono text-xs font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            {s.correctCount} Correct
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 font-mono text-xs font-bold flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            {s.wrongCount} Wrong
                          </span>
                          {s.skippedCount > 0 && (
                            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 font-mono text-xs font-semibold">
                              {s.skippedCount} Skipped
                            </span>
                          )}

                          <div className="px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs sm:text-sm font-bold text-white">
                            {s.earnedPoints}/{s.totalPoints} pts ({s.percentage}%)
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSubmissionId((prev) => (prev === s.id ? null : s.id))
                            }
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
                              isExpanded
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border-indigo-500/30'
                            }`}
                          >
                            <span>{isExpanded ? 'Hide Answers' : 'View Correct & Wrong Answers'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteSubmission(s.id)}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 transition"
                            title="Delete Student Result"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Detailed Question-by-Question Breakdown for this Student */}
                      {isExpanded && (
                        <div className="border-t border-slate-800/90 bg-slate-900/60 p-4 sm:p-6 space-y-3 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                              Question-by-Question Answer Sheet — {s.studentName} ({s.studentRoll})
                            </h4>
                            <span className="text-xs text-slate-400">
                              {s.correctCount} Correct · {s.wrongCount} Wrong · {s.skippedCount} Unanswered
                            </span>
                          </div>

                          {(!s.answers || s.answers.length === 0) ? (
                            <p className="text-xs text-slate-400">No individual question records stored for this submission.</p>
                          ) : (
                            <div className="space-y-3">
                              {s.answers.map((ans, qIdx) => {
                                const isSkipped = ans.chosenIndex < 0;
                                return (
                                  <div
                                    key={ans.questionId || qIdx}
                                    className={`p-4 rounded-xl border space-y-2.5 text-xs sm:text-sm ${
                                      ans.isCorrect
                                        ? 'bg-emerald-950/20 border-emerald-500/30'
                                        : isSkipped
                                        ? 'bg-slate-950/80 border-slate-800'
                                        : 'bg-rose-950/20 border-rose-500/30'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-start gap-2.5">
                                        {ans.isCorrect ? (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                        ) : isSkipped ? (
                                          <MinusCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                        ) : (
                                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                        )}
                                        <span className="font-semibold text-white leading-snug">
                                          Q{qIdx + 1}. {ans.questionText}
                                        </span>
                                      </div>

                                      <span
                                        className={`font-mono text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                                          ans.isCorrect
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : isSkipped
                                            ? 'bg-slate-800 text-slate-300'
                                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                        }`}
                                      >
                                        {ans.isCorrect
                                          ? `✓ CORRECT (+${ans.points} pts)`
                                          : isSkipped
                                          ? 'UNANSWERED (0 pts)'
                                          : '✗ WRONG (0 pts)'}
                                      </span>
                                    </div>

                                    {/* All options with Student's Pick vs Correct Answer highlighted */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6 pt-1">
                                      {ans.options.map((optText, optIdx) => {
                                        const isStudentPick = ans.chosenIndex === optIdx;
                                        const isRightOption = ans.correctIndex === optIdx;
                                        return (
                                          <div
                                            key={optIdx}
                                            className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                                              isRightOption
                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-semibold'
                                                : isStudentPick && !ans.isCorrect
                                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-200 font-semibold'
                                                : 'bg-slate-950/70 border-slate-800/80 text-slate-400'
                                            }`}
                                          >
                                            <span>
                                              <strong className="font-mono mr-1.5">
                                                {['A', 'B', 'C', 'D'][optIdx] || optIdx + 1}.
                                              </strong>
                                              {optText}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                              {isStudentPick && (
                                                <span
                                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                    ans.isCorrect
                                                      ? 'bg-emerald-600 text-white'
                                                      : 'bg-rose-600 text-white'
                                                  }`}
                                                >
                                                  Student Answer
                                                </span>
                                              )}
                                              {isRightOption && !isStudentPick && (
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-200 text-[10px] font-bold">
                                                  Correct Key
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* PER-QUESTION CLASS ACCURACY SUMMARY */}
          {questionAccuracyStats && (
            <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-white">
                  Question Accuracy Breakdown — {questionAccuracyStats.exam.title} ({questionAccuracyStats.exam.code})
                </h3>
                <p className="text-xs text-slate-400">
                  Shows how many students answered each question right vs. wrong across {questionAccuracyStats.totalStudents} submission{questionAccuracyStats.totalStudents === 1 ? '' : 's'}
                </p>
              </div>
              <div className="space-y-2.5">
                {questionAccuracyStats.questions.map((qStat) => (
                  <div
                    key={qStat.index}
                    className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="font-semibold text-white">
                        Q{qStat.index}. {qStat.questionText}
                      </p>
                      <p className="text-emerald-400">
                        Correct Answer: <strong>{qStat.correctAnswer}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 font-mono">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 font-bold">
                        ✓ {qStat.correct} Right
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 font-bold">
                        ✗ {qStat.wrong} Wrong
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 font-bold">
                        {qStat.accuracyPercent}% Accuracy
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RECHARTS: AVERAGE STUDENT PERFORMANCE ACROSS ALL EXAMS */}
          <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-7 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/90 pb-5">
              <div>
                <h3 className="text-base sm:text-lg font-display font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                  <span>Average Student Performance Across All Exams</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Bar chart of average percentage scores achieved by students per assessment
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> ≥75% Excellent
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" /> 60–74% Passing
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> &lt;60% Review
                </span>
              </div>
            </div>

            {performanceChartData.length === 0 ? (
              <div className="py-12 text-center space-y-2 bg-slate-950/60 rounded-xl border border-slate-800/70">
                <p className="text-sm font-semibold text-slate-300">No quizzes created yet</p>
                <p className="text-xs text-slate-500">
                  Create a quiz in the Create Quiz tab to view average student performance analytics here.
                </p>
              </div>
            ) : (
              <div className="h-80 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={performanceChartData}
                    margin={{ top: 16, right: 20, left: -8, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis
                      dataKey="code"
                      stroke="#64748b"
                      tick={{ fill: '#cbd5e1', fontSize: 12, fontWeight: 600 }}
                      axisLine={{ stroke: '#1e293b' }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      unit="%"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      axisLine={{ stroke: '#1e293b' }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/80 p-3.5 rounded-xl shadow-2xl text-xs space-y-2">
                              <p className="font-display font-bold text-white text-sm">{data.title}</p>
                              <div className="border-t border-slate-800 pt-2 space-y-1">
                                <p className="text-slate-300">
                                  Exam Code:{' '}
                                  <span className="font-mono text-indigo-400 font-semibold">
                                    {data.code}
                                  </span>
                                </p>
                                <p className="text-emerald-400 font-semibold">
                                  Average Score: <span className="font-mono">{data.avgScore}%</span>
                                </p>
                                {data.submissionsCount > 0 && (
                                  <p className="text-amber-300">
                                    Highest Score: <span className="font-mono">{data.highestScore}%</span>
                                  </p>
                                )}
                                <p className="text-slate-400">
                                  Submissions: <span className="font-mono">{data.submissionsCount}</span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="avgScore" radius={[8, 8, 0, 0]} maxBarSize={56}>
                      {performanceChartData.map((entry, index) => {
                        let color = '#6366f1';
                        if (entry.avgScore >= 75) color = '#10b981';
                        else if (entry.avgScore < 60) color = '#f59e0b';
                        return <Cell key={`cell-${index}`} fill={color} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share Modal */}
      <ShareExamModal
        isOpen={Boolean(shareExamTarget)}
        exam={shareExamTarget}
        onClose={() => setShareExamTarget(null)}
        onShowToast={onShowToast}
      />
    </div>
  );
};
