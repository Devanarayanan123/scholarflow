import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  GraduationCap,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import { loadGoogleIdentityScript } from '../utils/auth';

interface TeacherLoginProps {
  googleClientId: string;
  hasRegisteredTeacher: boolean;
  isSigningIn: boolean;
  error: string;
  onLoginSubmit: (payload: {
    mode: 'signin' | 'register';
    email: string;
    password: string;
    name?: string;
    institution?: string;
  }) => void;
  onCredential: (credential: string) => void;
}

export const TeacherLogin: React.FC<TeacherLoginProps> = ({
  googleClientId,
  hasRegisteredTeacher,
  isSigningIn,
  error,
  onLoginSubmit,
  onCredential
}) => {
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  const [mode, setMode] = useState<'signin' | 'register'>(() =>
    hasRegisteredTeacher ? 'signin' : 'register'
  );

  // Always start completely empty (never pre-fill or retain password after sign-out)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [localError, setLocalError] = useState('');

  // Quick student quiz code launcher (redirects to isolated Student Portal)
  const [studentQuizCode, setStudentQuizCode] = useState('');

  useEffect(() => {
    setMode(hasRegisteredTeacher ? 'signin' : 'register');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setInstitution('');
    setLocalError('');
  }, [hasRegisteredTeacher]);

  const switchMode = (nextMode: 'signin' | 'register') => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setLocalError('');
  };

  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response: { credential?: string }) => {
            if (response?.credential) callbackRef.current(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true
        });
        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: 280
        });
      })
      .catch(() => {
        /* fallback to verified Gmail + password form */
      });

    return () => {
      cancelled = true;
    };
  }, [googleClientId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (mode === 'register') {
      if (!name.trim() || name.trim().length < 2) {
        setLocalError('Please enter your full name to create your teacher account.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match. Please re-enter your password.');
        setPassword('');
        setConfirmPassword('');
        return;
      }
    }

    const submittedPassword = password;
    // Clear password state immediately upon submit so it is never left in memory/DOM
    setPassword('');
    setConfirmPassword('');

    onLoginSubmit({
      mode,
      email: email.trim(),
      password: submittedPassword,
      name: name.trim() || undefined,
      institution: institution.trim() || undefined
    });
  };

  const handleStudentJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = studentQuizCode.trim().toUpperCase();
    if (!trimmed) return;
    window.location.href = `${window.location.origin}${window.location.pathname}?exam=${encodeURIComponent(trimmed)}`;
  };

  const displayError = localError || error;

  return (
    <div className="max-w-md mx-auto my-6 sm:my-10 space-y-6">
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/95 border border-slate-800/90 space-y-6 shadow-2xl">
        {/* Header */}
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
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              Teacher Portal
            </h2>
            <p className="text-xs text-slate-400">
              Sign in to your own Teacher Gmail account to create &amp; share quizzes with your students
            </p>
          </div>
        </div>

        {/* Mode Switcher: Sign In vs Create Teacher Account */}
        <div className="grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              mode === 'signin'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Teacher Sign In</span>
          </button>

          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              mode === 'register'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Teacher Account</span>
          </button>
        </div>

        {/* Multi-Teacher Isolation Info */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 flex items-start gap-2.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            {mode === 'signin' ? (
              <>
                <strong className="text-white">Private Teacher Workspace:</strong> Sign in with your registered Gmail &amp; password to manage your quizzes and view your students&apos; scores.
              </>
            ) : (
              <>
                <strong className="text-white">Register Your Teacher Account:</strong> Connect your genuine Gmail address to generate quizzes with Gemini AI and share quiz links with your students.
              </>
            )}
          </span>
        </div>

        {googleClientId && (
          <div className="flex flex-col items-center gap-2 pb-2 border-b border-slate-800">
            <div ref={buttonRef} className={isSigningIn ? 'opacity-40 pointer-events-none' : ''} />
          </div>
        )}

        {displayError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-start gap-2 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Teacher Full Name *
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  School / Institution (Optional)
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="Enter your school or department"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Teacher Gmail Address *
            </label>
            <input
              type="email"
              name="teacher_gmail_input"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your genuine @gmail.com address"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {mode === 'signin' ? 'Password *' : 'Create Password (min 6 characters) *'}
            </label>
            <input
              type="password"
              name="teacher_secret_key"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signin' ? 'Enter your password' : 'Create a password'}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Confirm Password *
              </label>
              <input
                type="password"
                name="teacher_secret_confirm"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSigningIn}
            className="w-full py-3 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {isSigningIn ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{mode === 'signin' ? 'Signing In...' : 'Creating Account...'}</span>
              </>
            ) : (
              <>
                <span>
                  {mode === 'signin' ? 'Sign In to Teacher Dashboard' : 'Create Teacher Account & Sign In'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Student Quick-Join Box (takes students directly to the isolated Student Portal) */}
      <div className="p-5 rounded-2xl bg-slate-900/75 border border-slate-800/80 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white">
              Are you a Student taking a Quiz?
            </h3>
            <p className="text-[11px] text-slate-400">
              Enter the Quiz Code shared by your teacher to start your assessment
            </p>
          </div>
        </div>

        <form onSubmit={handleStudentJoin} className="flex gap-2">
          <input
            type="text"
            value={studentQuizCode}
            onChange={(e) => setStudentQuizCode(e.target.value.toUpperCase())}
            placeholder="Enter Quiz Code (e.g. MATH-4821)"
            className="flex-1 rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500 px-3.5 py-2 text-xs sm:text-sm font-mono uppercase text-slate-100 outline-none"
          />
          <button
            type="submit"
            disabled={!studentQuizCode.trim()}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold transition shrink-0"
          >
            Join Quiz
          </button>
        </form>
      </div>
    </div>
  );
};
