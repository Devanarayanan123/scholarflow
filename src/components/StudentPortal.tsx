import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock,
  Play,
  ChevronLeft,
  ChevronRight,
  Check,
  GraduationCap,
  Layers,
  Award,
  CheckCircle2,
  XCircle,
  MinusCircle,
  User,
  Hash,
  Loader2,
  AlertCircle,
  KeyRound
} from 'lucide-react';
import { Exam, Question, Submission, ViolationLog } from '../types';
import { formatTime, getExamShareUrl, shuffleArray } from '../utils/helpers';
import { api } from '../utils/api';
import { AntiCheatViolationModal } from './AntiCheatViolationModal';
import { MathText } from './MathText';

interface StudentPortalProps {
  examCode: string;
}

/** A question as displayed to the student; optionOrder maps displayed index -> original index. */
interface DisplayQuestion extends Question {
  optionOrder: number[];
}

interface ActiveSession {
  questions: DisplayQuestion[];
  currentIndex: number;
  selectedMap: Record<string, number>; // questionId -> displayed option index
  reviewMap: Record<string, boolean>;
  startedAt: number;
  allocatedSeconds: number;
  remainingSeconds: number;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({ examCode }) => {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>(
    examCode ? 'loading' : 'missing'
  );
  const [loadError, setLoadError] = useState('');
  const [exam, setExam] = useState<Exam | null>(null);
  const [codeInput, setCodeInput] = useState('');

  const [candidateName, setCandidateName] = useState('');
  const [candidateRoll, setCandidateRoll] = useState('');
  const [regError, setRegError] = useState<{ name?: string; roll?: string }>({});

  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [completedResult, setCompletedResult] = useState<Submission | null>(null);
  const [confirmSubmitModal, setConfirmSubmitModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [currentViolation, setCurrentViolation] = useState<ViolationLog | null>(null);
  const [isNavModalOpen, setIsNavModalOpen] = useState(false);

  const isSubmittingRef = useRef(false);
  const autoSubmitAttemptedRef = useRef(false);

  // Load the quiz (questions only – the answer key never leaves the server)
  useEffect(() => {
    if (!examCode) return;
    let cancelled = false;
    setLoadState('loading');
    api
      .getPublicExam(examCode)
      .then((data) => {
        if (cancelled) return;
        setExam(data);
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message || 'Could not load this quiz.');
        setLoadState(err?.status === 404 ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [examCode]);

  const submitExam = useCallback(
    async (isAutoSubmitted = false) => {
      if (!activeSession || !exam || isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitError('');

      const answers: Record<string, number> = {};
      activeSession.questions.forEach((q) => {
        const displayed = activeSession.selectedMap[q.id];
        if (displayed !== undefined) answers[q.id] = q.optionOrder[displayed];
      });

      const timeTakenSeconds = Math.max(
        1,
        Math.min(
          activeSession.allocatedSeconds,
          Math.round((Date.now() - activeSession.startedAt) / 1000)
        )
      );

      try {
        const result = await api.submitExam(exam.code, {
          studentName: candidateName.trim(),
          studentRoll: candidateRoll.trim(),
          answers,
          timeTakenSeconds,
          autoSubmitted: isAutoSubmitted
        });
        setCompletedResult(result);
        setActiveSession(null);
        setConfirmSubmitModal(false);
        setIsNavModalOpen(false);
      } catch (err: any) {
        setSubmitError(err?.message || 'Could not submit your answers. Please try again.');
        setConfirmSubmitModal(true);
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [activeSession, exam, candidateName, candidateRoll]
  );

  // Countdown timer
  useEffect(() => {
    if (!activeSession) return;
    const timer = setInterval(() => {
      setActiveSession((prev) => {
        if (!prev || prev.remainingSeconds <= 0) return prev;
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeSession?.startedAt]);

  // Auto-submit once when time runs out
  useEffect(() => {
    if (activeSession && activeSession.remainingSeconds <= 0 && !autoSubmitAttemptedRef.current) {
      autoSubmitAttemptedRef.current = true;
      submitExam(true);
    }
  }, [activeSession?.remainingSeconds, submitExam]);

  // Prevent accidental back navigation / page close during the quiz
  useEffect(() => {
    if (!activeSession) return;
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      setCurrentViolation({
        timestamp: Date.now(),
        type: 'back_navigation',
        description: 'Browser back navigation paused during quiz'
      });
      setIsNavModalOpen(true);
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Quiz in progress. Leaving will lose your answers.';
      return e.returnValue;
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activeSession?.startedAt]);

  const handleStartExam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!exam) return;

    const errors: { name?: string; roll?: string } = {};
    if (candidateName.trim().length < 2) errors.name = 'Please enter your full name.';
    if (candidateRoll.trim().length < 1) errors.roll = 'Please enter your Student ID or Roll Number.';
    if (errors.name || errors.roll) {
      setRegError(errors);
      return;
    }
    setRegError({});

    let questions: DisplayQuestion[] = exam.questions.map((q) => {
      const base = q.options.map((_, i) => i);
      const order = exam.shuffleOptions ? shuffleArray(base) : base;
      return { ...q, options: order.map((i) => q.options[i]), optionOrder: order };
    });
    if (exam.shuffleQuestions) questions = shuffleArray(questions);

    const durationSeconds = Math.max(60, (exam.defaultTimeLimitMinutes || 15) * 60);
    autoSubmitAttemptedRef.current = false;
    setSubmitError('');
    setActiveSession({
      questions,
      currentIndex: 0,
      selectedMap: {},
      reviewMap: {},
      startedAt: Date.now(),
      allocatedSeconds: durationSeconds,
      remainingSeconds: durationSeconds
    });
  };

  const goToCode = (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (code) window.location.href = getExamShareUrl(code);
  };

  // ---------------- Loading / not found ----------------
  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading quiz...
      </div>
    );
  }

  if (loadState === 'missing' || loadState === 'error') {
    return (
      <div className="max-w-md mx-auto my-10 p-6 sm:p-8 rounded-3xl bg-slate-900/95 border border-slate-800/90 space-y-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">Join a Quiz</h2>
            <p className="text-xs text-slate-400">Enter the quiz code given by your teacher</p>
          </div>
        </div>
        {examCode && loadError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-start gap-2 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}
        <form onSubmit={goToCode} className="flex gap-2">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="Quiz code"
            className="flex-1 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm font-mono uppercase text-slate-100 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition"
          >
            Join
          </button>
        </form>
      </div>
    );
  }

  if (!exam) return null;

  const answeredCount = activeSession ? Object.keys(activeSession.selectedMap).length : 0;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
      <AntiCheatViolationModal
        isOpen={isNavModalOpen}
        violation={currentViolation}
        onDismiss={() => setIsNavModalOpen(false)}
      />

      {/* 1. REGISTRATION */}
      {!activeSession && !completedResult && (
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-800/90 pb-5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/15 border border-indigo-500/25 px-2 py-0.5 rounded-md">
                  {exam.code}
                </span>
                {exam.difficulty && (
                  <span className="text-[11px] font-medium text-slate-300 bg-slate-800 px-2 py-0.5 rounded-md">
                    {exam.difficulty}
                  </span>
                )}
              </div>
              <h1 className="text-lg sm:text-2xl font-display font-bold text-white tracking-tight mt-1">
                {exam.title}
              </h1>
              {exam.description && <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{exam.description}</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              {exam.questions.length} Questions
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs font-mono font-bold text-amber-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {exam.defaultTimeLimitMinutes} minutes (set by your teacher)
            </span>
          </div>

          <form onSubmit={handleStartExam} noValidate className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Full Name *</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={candidateName}
                    onChange={(e) => {
                      setCandidateName(e.target.value);
                      if (regError.name) setRegError((p) => ({ ...p, name: undefined }));
                    }}
                    placeholder="Enter your full name"
                    className={`w-full rounded-xl bg-slate-950 border pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none ${
                      regError.name ? 'border-rose-500/80' : 'border-slate-800 focus:border-indigo-500'
                    }`}
                  />
                </div>
                {regError.name && <p className="text-[11px] text-rose-400 mt-1 font-medium">{regError.name}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Student ID / Roll Number *</label>
                <div className="relative">
                  <Hash className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={candidateRoll}
                    onChange={(e) => {
                      setCandidateRoll(e.target.value);
                      if (regError.roll) setRegError((p) => ({ ...p, roll: undefined }));
                    }}
                    placeholder="Enter your Student ID or Roll Number"
                    className={`w-full rounded-xl bg-slate-950 border pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none ${
                      regError.roll ? 'border-rose-500/80' : 'border-slate-800 focus:border-indigo-500'
                    }`}
                  />
                </div>
                {regError.roll && <p className="text-[11px] text-rose-400 mt-1 font-medium">{regError.roll}</p>}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-display font-bold text-sm shadow-xl shadow-indigo-600/25 flex items-center justify-center gap-2 transition"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Quiz</span>
            </button>
          </form>
        </div>
      )}

      {/* 2. ACTIVE QUIZ */}
      {activeSession && (
        <div
          className="space-y-4 select-none"
          onContextMenu={(e) => e.preventDefault()}
          onCopy={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
        >
          <div className="sticky top-16 z-30 bg-slate-900/95 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-indigo-400">{exam.code}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 truncate">
                    {candidateName.trim()} ({candidateRoll.trim()})
                  </span>
                </div>
                <h3 className="font-display font-bold text-white text-sm sm:text-base truncate mt-0.5">{exam.title}</h3>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <div
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-mono font-bold text-xs sm:text-sm ${
                    activeSession.remainingSeconds <= 60
                      ? 'bg-rose-950/90 border-rose-500 text-rose-300 animate-pulse'
                      : 'bg-slate-950 border-slate-800 text-emerald-400'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>{formatTime(activeSession.remainingSeconds)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmSubmitModal(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                >
                  Finish Quiz
                </button>
              </div>
            </div>

            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.round((answeredCount / Math.max(1, activeSession.questions.length)) * 100)}%` }}
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
              {activeSession.questions.map((q, idx) => {
                const isCurrent = idx === activeSession.currentIndex;
                const isAnswered = activeSession.selectedMap[q.id] !== undefined;
                const isFlagged = Boolean(activeSession.reviewMap[q.id]);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setActiveSession((prev) => (prev ? { ...prev, currentIndex: idx } : prev))}
                    className={`relative w-8 h-8 rounded-lg font-mono text-xs font-bold shrink-0 flex items-center justify-center border transition-all ${
                      isCurrent
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : isFlagged
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : isAnswered
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {idx + 1}
                    {isFlagged && <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {(() => {
            const currentQ = activeSession.questions[activeSession.currentIndex];
            if (!currentQ) return null;
            const selectedOpt = activeSession.selectedMap[currentQ.id];
            const isFlagged = Boolean(activeSession.reviewMap[currentQ.id]);

            return (
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-8 space-y-6 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between border-b border-slate-800/90 pb-3.5 gap-2 text-xs">
                  <span className="font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-lg">
                    Question {activeSession.currentIndex + 1} of {activeSession.questions.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveSession((prev) =>
                          prev
                            ? { ...prev, reviewMap: { ...prev.reviewMap, [currentQ.id]: !prev.reviewMap[currentQ.id] } }
                            : prev
                        )
                      }
                      className={`px-3 py-1 rounded-lg border font-semibold transition ${
                        isFlagged
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isFlagged ? '★ Flagged' : '☆ Flag for review'}
                    </button>
                    {selectedOpt !== undefined && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveSession((prev) => {
                            if (!prev) return prev;
                            const next = { ...prev.selectedMap };
                            delete next[currentQ.id];
                            return { ...prev, selectedMap: next };
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-rose-300 transition"
                      >
                        Clear
                      </button>
                    )}
                    <span className="font-mono font-semibold text-slate-300 bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg">
                      {currentQ.points} {currentQ.points === 1 ? 'pt' : 'pts'}
                    </span>
                  </div>
                </div>

                <h4 className="text-base sm:text-lg font-display font-semibold text-white leading-relaxed">
                  <MathText text={currentQ.q} />
                </h4>

                <div className="space-y-3 pt-1">
                  {currentQ.options.map((optText, optIdx) => {
                    const isSelected = selectedOpt === optIdx;
                    return (
                      <button
                        type="button"
                        key={optIdx}
                        onClick={() =>
                          setActiveSession((prev) =>
                            prev ? { ...prev, selectedMap: { ...prev.selectedMap, [currentQ.id]: optIdx } } : prev
                          )
                        }
                        className={`w-full text-left p-4 rounded-xl border flex items-start sm:items-center gap-3.5 transition-all ${
                          isSelected
                            ? 'bg-indigo-600/20 border-indigo-500 text-white'
                            : 'bg-slate-950/90 border-slate-800/90 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}
                        </span>
                        <span className="text-sm sm:text-base leading-snug">
                          <MathText text={optText} />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-slate-800/90 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={activeSession.currentIndex === 0}
                    onClick={() =>
                      setActiveSession((prev) =>
                        prev ? { ...prev, currentIndex: Math.max(0, prev.currentIndex - 1) } : prev
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5 transition"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                    {answeredCount} of {activeSession.questions.length} answered
                  </span>
                  {activeSession.currentIndex < activeSession.questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setActiveSession((prev) =>
                          prev
                            ? { ...prev, currentIndex: Math.min(prev.questions.length - 1, prev.currentIndex + 1) }
                            : prev
                        )
                      }
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5 transition"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmSubmitModal(true)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 transition"
                    >
                      Submit Quiz <Check className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Confirm / retry submit dialog */}
      {confirmSubmitModal && activeSession && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base sm:text-lg font-display font-bold text-white">
              {activeSession.remainingSeconds <= 0 ? 'Time is up' : 'Submit your quiz?'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400">
              You answered <strong className="text-white">{answeredCount}</strong> of{' '}
              <strong className="text-white">{activeSession.questions.length}</strong> questions.
            </p>
            {submitError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-start gap-2 text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2.5 pt-2">
              {activeSession.remainingSeconds > 0 && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setConfirmSubmitModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition disabled:opacity-50"
                >
                  Review Answers
                </button>
              )}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => submitExam(activeSession.remainingSeconds <= 0)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitError ? 'Retry Submit' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. RESULT */}
      {completedResult && (
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-8 space-y-6 shadow-2xl animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/90 pb-6 gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                <Award className="w-3.5 h-3.5" />
                <span>Submitted to your teacher</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-white pt-1">{completedResult.examTitle}</h2>
              <p className="text-xs sm:text-sm text-slate-400">
                {completedResult.studentName} · <span className="font-mono">{completedResult.studentRoll}</span>
              </p>
            </div>
            <div className="flex sm:flex-col items-center sm:items-end justify-between bg-slate-950/90 border border-slate-800 px-5 py-3.5 rounded-2xl">
              <span className="text-2xl sm:text-3xl font-display font-bold font-mono text-white">
                {completedResult.earnedPoints} / {completedResult.totalPoints}
              </span>
              <span
                className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full mt-1 ${
                  completedResult.percentage >= 60
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}
              >
                {completedResult.percentage}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Correct" value={completedResult.correctCount} className="text-emerald-400" />
            <Stat label="Wrong" value={completedResult.wrongCount} className="text-rose-400" />
            <Stat label="Unanswered" value={completedResult.skippedCount} className="text-slate-300" />
            <Stat label="Time Taken" value={formatTime(completedResult.timeTakenSeconds)} className="text-indigo-300" />
          </div>

          {completedResult.answers.length > 0 && (
            <div className="space-y-3.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Answer Review</h4>
              {completedResult.answers.map((ans, i) => {
                const skipped = ans.chosenIndex < 0;
                return (
                  <div key={ans.questionId} className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-slate-800/90 space-y-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        {ans.isCorrect ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : skipped ? (
                          <MinusCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <span className="font-semibold text-white leading-snug">
                          Q{i + 1}. <MathText text={ans.questionText} />
                        </span>
                      </div>
                      <span
                        className={`font-mono text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
                          ans.isCorrect ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {ans.isCorrect ? `+${ans.points}` : '0'} pts
                      </span>
                    </div>
                    <div className="pl-6 space-y-1 text-xs">
                      <div className="text-slate-400">
                        Your answer:{' '}
                        <strong className={ans.isCorrect ? 'text-emerald-300' : 'text-rose-300'}>
                          {skipped ? 'Not answered' : <MathText text={ans.options[ans.chosenIndex]} />}
                        </strong>
                      </div>
                      {!ans.isCorrect && (
                        <div className="text-slate-400">
                          Correct answer:{' '}
                          <strong className="text-emerald-300">
                            <MathText text={ans.options[ans.correctIndex]} />
                          </strong>
                        </div>
                      )}
                      {ans.explanation && (
                        <p className="text-slate-400 border-t border-slate-800/80 pt-2 mt-2 leading-relaxed">
                          <span className="text-slate-300 font-semibold">Explanation:</span>{' '}
                          <MathText text={ans.explanation} />
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-slate-500 text-center">You can close this page now.</p>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; className: string }> = ({ label, value, className }) => (
  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
    <span className="text-[11px] text-slate-400 block">{label}</span>
    <span className={`text-base font-mono font-bold ${className}`}>{value}</span>
  </div>
);
