import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, AlertTriangle, LogOut, Loader2 } from 'lucide-react';
import { Exam, Submission } from './types';
import { api, TeacherProfile } from './utils/api';
import { clearLegacyBrowserData, disableGoogleAutoSelect } from './utils/auth';
import { getExamShareUrl, setConfiguredCloudUrl } from './utils/helpers';
import { StudentPortal } from './components/StudentPortal';
import { TeacherDashboard } from './components/TeacherDashboard';
import { TeacherLogin } from './components/TeacherLogin';

type ShowToast = (message: string, type?: 'success' | 'error') => void;

function getShareCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('exam') ?? params.get('join');
  return code === null ? null : code.trim();
}

export default function App() {
  const [shareCode] = useState<string | null>(() => getShareCodeFromUrl());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast: ShowToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    clearLegacyBrowserData();
  }, []);

  return (
    <div className="min-h-screen text-slate-100 flex flex-col font-sans">
      {toast && (
        <div className="fixed bottom-5 right-4 sm:right-6 z-[60] animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-sm">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border text-xs sm:text-sm font-semibold ${
              toast.type === 'error'
                ? 'bg-rose-950/95 border-rose-500/40 text-rose-100'
                : 'bg-slate-900/95 border-emerald-500/40 text-emerald-100'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Students opening a quiz link never see any teacher UI */}
      {shareCode !== null ? (
        <>
          <AppHeader />
          <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <StudentPortal examCode={shareCode} />
          </main>
        </>
      ) : (
        <TeacherArea showToast={showToast} />
      )}
    </div>
  );
}

const AppHeader: React.FC<{ right?: React.ReactNode }> = ({ right }) => (
  <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/25">
          <BookOpen className="w-4 h-4" />
        </div>
        <div className="leading-tight">
          <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white block">
            ScholarFlow
          </span>
          <span className="text-[10px] font-medium text-slate-400 hidden sm:block">
            AI Quiz &amp; Assessment Platform
          </span>
        </div>
      </div>
      {right}
    </div>
  </header>
);

const TeacherArea: React.FC<{ showToast: ShowToast }> = ({ showToast }) => {
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'signedIn'>('loading');
  const [config, setConfig] = useState<{ googleClientId: string; hasRegisteredTeacher: boolean; cloudUrl?: string }>({
    googleClientId: '',
    hasRegisteredTeacher: false,
    cloudUrl: ''
  });
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loginResetKey, setLoginResetKey] = useState(0);

  const resetToSignedOut = useCallback(() => {
    setTeacher(null);
    setExams([]);
    setSubmissions([]);
    setStatus('signedOut');
    setLoginResetKey((prev) => prev + 1);
  }, []);

  const handleApiError = useCallback(
    (err: any) => {
      if (err?.status === 401) {
        resetToSignedOut();
        showToast('Your session has ended. Please sign in again.', 'error');
        return;
      }
      showToast(err?.message || 'Something went wrong.', 'error');
    },
    [resetToSignedOut, showToast]
  );

  const loadTeacherData = useCallback(async () => {
    const [examList, subList] = await Promise.all([api.listExams(), api.listSubmissions()]);
    setExams(examList);
    setSubmissions(subList);
  }, []);

  // Initial load: server config + existing session (HTTP-only cookie)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, current] = await Promise.all([api.getConfig(), api.getCurrentTeacher()]);
        if (cancelled) return;
        setConfig(cfg);
        if (cfg.cloudUrl) {
          setConfiguredCloudUrl(cfg.cloudUrl);
        }
        if (current) {
          setTeacher(current);
          await loadTeacherData();
          if (!cancelled) setStatus('signedIn');
        } else {
          setStatus('signedOut');
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatus('signedOut');
          setLoginError(err?.message || 'Could not reach the server.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTeacherData]);

  const refreshSubmissions = useCallback(
    async (silent = false) => {
      if (!silent) setIsRefreshing(true);
      try {
        setSubmissions(await api.listSubmissions());
      } catch (err) {
        if (!silent) handleApiError(err);
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    [handleApiError]
  );

  // Keep results up to date while the teacher has the dashboard open
  useEffect(() => {
    if (status !== 'signedIn') return;
    const id = window.setInterval(() => refreshSubmissions(true), 20000);
    return () => window.clearInterval(id);
  }, [status, refreshSubmissions]);

  const handleLoginSubmit = async (payload: {
    mode: 'signin' | 'register';
    email: string;
    password: string;
    name?: string;
    institution?: string;
  }) => {
    setIsSigningIn(true);
    setLoginError('');
    try {
      const profile = await api.loginWithGmail(payload);
      setTeacher(profile);
      setConfig((prev) => ({ ...prev, hasRegisteredTeacher: true }));
      await loadTeacherData();
      setStatus('signedIn');
      showToast(`Signed in as ${profile.email}`);
    } catch (err: any) {
      setLoginError(err?.message || 'Sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleCredential = async (credential: string) => {
    setIsSigningIn(true);
    setLoginError('');
    try {
      const profile = await api.signInWithGoogle(credential);
      setTeacher(profile);
      setConfig((prev) => ({ ...prev, hasRegisteredTeacher: true }));
      await loadTeacherData();
      setStatus('signedIn');
      showToast(`Signed in as ${profile.email}`);
    } catch (err: any) {
      setLoginError(err?.message || 'Sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.signOut();
      const updatedCfg = await api.getConfig().catch(() => null);
      if (updatedCfg) setConfig(updatedCfg);
    } catch {
      /* clear the local view anyway */
    }
    disableGoogleAutoSelect();
    clearLegacyBrowserData();
    resetToSignedOut();
    setLoginError('');
    showToast('Signed out — session and password cleared');
  };

  const handleSaveExam = async (exam: Exam) => {
    try {
      const saved = await api.saveExam(exam);
      setExams((prev) => {
        const idx = prev.findIndex((e) => e.code === saved.code);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [saved, ...prev];
      });
    } catch (err) {
      handleApiError(err);
    }
  };

  const handleExamGenerated = (exam: Exam) => {
    setExams((prev) => [exam, ...prev.filter((e) => e.code !== exam.code)]);
  };

  const handleDeleteExam = async (code: string) => {
    const count = submissions.filter((s) => s.examCode === code).length;
    const ok = window.confirm(
      count > 0
        ? `Delete quiz ${code} and its ${count} student result${count > 1 ? 's' : ''}? This cannot be undone.`
        : `Delete quiz ${code}? This cannot be undone.`
    );
    if (!ok) return;
    try {
      await api.deleteExam(code);
      setExams((prev) => prev.filter((e) => e.code !== code));
      setSubmissions((prev) => prev.filter((s) => s.examCode !== code));
      showToast(`Deleted quiz ${code}`);
    } catch (err) {
      handleApiError(err);
    }
  };

  const handleDeleteSubmission = async (id: string) => {
    if (!window.confirm('Delete this student result? This cannot be undone.')) return;
    try {
      await api.deleteSubmission(id);
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
      showToast('Result deleted');
    } catch (err) {
      handleApiError(err);
    }
  };

  const handleSaveCloudUrl = async (newUrl: string) => {
    try {
      const res = await api.saveCloudUrl(newUrl);
      setConfig((prev) => ({ ...prev, cloudUrl: res.cloudUrl }));
      setConfiguredCloudUrl(res.cloudUrl);
      if (typeof window !== 'undefined') {
        localStorage.setItem('scholarflow_cloud_url', res.cloudUrl);
      }
      showToast(newUrl ? 'Cloud Domain updated!' : 'Reset to default domain');
      return true;
    } catch (err: any) {
      handleApiError(err);
      return false;
    }
  };

  return (
    <>
      <AppHeader
        right={
          status === 'signedIn' && teacher ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 font-medium">
                {teacher.picture ? (
                  <img src={teacher.picture} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                )}
                <span className="max-w-[200px] truncate">{teacher.email}</span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-slate-900 hover:bg-rose-500/15 border border-slate-800 hover:border-rose-500/30 text-xs font-medium text-slate-400 hover:text-rose-300 flex items-center gap-1.5 transition"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : null
        }
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {status === 'loading' && (
          <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        )}

        {status === 'signedOut' && (
          <TeacherLogin
            key={loginResetKey}
            googleClientId={config.googleClientId}
            hasRegisteredTeacher={config.hasRegisteredTeacher}
            isSigningIn={isSigningIn}
            error={loginError}
            onLoginSubmit={handleLoginSubmit}
            onCredential={handleCredential}
          />
        )}

        {status === 'signedIn' && teacher && (
          <TeacherDashboard
            teacher={teacher}
            exams={exams}
            submissions={submissions}
            isRefreshing={isRefreshing}
            cloudUrl={config.cloudUrl}
            onSaveCloudUrl={handleSaveCloudUrl}
            onRefreshResults={() => refreshSubmissions(false)}
            onSaveExam={handleSaveExam}
            onExamGenerated={handleExamGenerated}
            onDeleteExam={handleDeleteExam}
            onDeleteSubmission={handleDeleteSubmission}
            onLogout={handleLogout}
            onPreviewExam={(code) => window.open(getExamShareUrl(code), '_blank', 'noopener')}
            onShowToast={showToast}
          />
        )}
      </main>
    </>
  );
};
