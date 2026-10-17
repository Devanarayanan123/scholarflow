import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  Settings,
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import { api } from '../utils/api';
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
  onPasswordResetSuccess: (payload: { email: string; code: string; newPassword: string }) => void;
  onCredential: (credential: string) => void;
}

export const TeacherLogin: React.FC<TeacherLoginProps> = ({
  googleClientId,
  hasRegisteredTeacher,
  isSigningIn,
  error,
  onLoginSubmit,
  onPasswordResetSuccess,
  onCredential
}) => {
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  // Check if user opened a password reset link from their email (?resetEmail=...&resetCode=...)
  const initialResetParams = (() => {
    if (typeof window === 'undefined') return { email: '', code: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      email: (params.get('resetEmail') || '').trim(),
      code: (params.get('resetCode') || '').trim()
    };
  })();

  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>(() => {
    if (initialResetParams.email) return 'forgot';
    return hasRegisteredTeacher ? 'signin' : 'register';
  });

  // Always start completely empty (never pre-fill or retain password after sign-out)
  const [email, setEmail] = useState(initialResetParams.email);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [localError, setLocalError] = useState('');

  // Forgot Password flow state
  const [forgotStep, setForgotStep] = useState<'request' | 'verify'>(() =>
    initialResetParams.email && initialResetParams.code ? 'verify' : 'request'
  );
  const [resetCode, setResetCode] = useState(initialResetParams.code);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false);
  const [resetStatusMsg, setResetStatusMsg] = useState('');
  const [emailPreviewUrl, setEmailPreviewUrl] = useState('');

  // Optional Gmail SMTP Sender Configuration (for direct Gmail-to-Gmail delivery)
  const [showSmtpSetup, setShowSmtpSetup] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);

  // Quick student quiz code launcher (redirects to isolated Student Portal)
  const [studentQuizCode, setStudentQuizCode] = useState('');

  useEffect(() => {
    if (initialResetParams.email) return;
    setMode(hasRegisteredTeacher ? 'signin' : 'register');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setInstitution('');
    setLocalError('');
  }, [hasRegisteredTeacher, initialResetParams.email]);

  const switchMode = (nextMode: 'signin' | 'register' | 'forgot') => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setLocalError('');
    setResetStatusMsg('');
    if (nextMode !== 'forgot') {
      setForgotStep('request');
      setResetCode('');
      setEmailPreviewUrl('');
    }
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
      mode: mode === 'register' ? 'register' : 'signin',
      email: email.trim(),
      password: submittedPassword,
      name: name.trim() || undefined,
      institution: institution.trim() || undefined
    });
  };

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setResetStatusMsg('');
    setEmailPreviewUrl('');

    if (!email.trim()) {
      setLocalError('Please enter the Gmail address of your Teacher account.');
      return;
    }

    setIsSendingResetEmail(true);
    try {
      const res = await api.requestPasswordReset(email.trim());
      setForgotStep('verify');
      setResetStatusMsg(res.message);
      if (res.emailPreviewUrl) {
        setEmailPreviewUrl(res.emailPreviewUrl);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Could not send reset email. Please check your Gmail address.');
    } finally {
      setIsSendingResetEmail(false);
    }
  };

  const handleVerifyAndResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!resetCode.trim() || resetCode.replace(/\s+/g, '').length < 6) {
      setLocalError('Please enter the 6-digit verification code sent to your Gmail.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setLocalError('Your new password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setLocalError('New passwords do not match. Please re-enter your new password.');
      setNewPassword('');
      setConfirmNewPassword('');
      return;
    }

    const submittedNewPassword = newPassword;
    const submittedCode = resetCode.replace(/\s+/g, '').trim();
    setNewPassword('');
    setConfirmNewPassword('');
    setResetCode('');

    // Clean URL params if user came from email link
    if (typeof window !== 'undefined' && window.location.search.includes('resetEmail')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    onPasswordResetSuccess({
      email: email.trim(),
      code: submittedCode,
      newPassword: submittedNewPassword
    });
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setIsSavingSmtp(true);
    try {
      const res = await api.configureSmtp({ smtpUser: smtpUser.trim(), smtpPass: smtpPass.trim() });
      setResetStatusMsg(res.message);
      setSmtpPass('');
      setShowSmtpSetup(false);
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to configure Gmail SMTP.');
    } finally {
      setIsSavingSmtp(false);
    }
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
              {mode === 'forgot' ? 'Reset Teacher Password' : 'Teacher Portal'}
            </h2>
            <p className="text-xs text-slate-400">
              {mode === 'forgot'
                ? 'Receive a 6-digit verification code on your registered Gmail account'
                : 'Sign in to your own Teacher Gmail account to create & share quizzes with your students'}
            </p>
          </div>
        </div>

        {/* Mode Switcher: Sign In vs Create Teacher Account */}
        {mode !== 'forgot' ? (
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
        ) : (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Teacher Sign In</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSmtpSetup(!showSmtpSetup)}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
              title="Configure Gmail App Password for direct inbox delivery"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Gmail SMTP Setup</span>
            </button>
          </div>
        )}

        {/* Info Banner */}
        {mode !== 'forgot' && (
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
        )}

        {googleClientId && mode !== 'forgot' && (
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

        {resetStatusMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 space-y-2.5 text-xs text-emerald-100">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{resetStatusMsg}</span>
            </div>
            {emailPreviewUrl && (
              <a
                href={emailPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Open Sent Reset Email (View 6-Digit Code)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Optional Gmail SMTP Sender Configuration Panel */}
        {mode === 'forgot' && showSmtpSetup && (
          <form
            onSubmit={handleSaveSmtp}
            className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/30 space-y-3 text-xs"
          >
            <div className="font-bold text-white flex items-center justify-between">
              <span>Direct Gmail Inbox Delivery (Optional)</span>
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
              >
                <span>Get Google App Password</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Enter a sender Gmail address and 16-character Google App Password to deliver reset emails directly to teachers&apos; Gmail inboxes.
            </p>
            <input
              type="email"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="Sender Gmail (e.g. yourschool@gmail.com)"
              className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder="16-char Google App Password (xxxx xxxx xxxx xxxx)"
              className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSmtpSetup(false)}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingSmtp}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold disabled:opacity-50"
              >
                {isSavingSmtp ? 'Verifying...' : 'Save Gmail Sender'}
              </button>
            </div>
          </form>
        )}

        {/* FORGOT PASSWORD FORM */}
        {mode === 'forgot' ? (
          <div className="space-y-4">
            {forgotStep === 'request' ? (
              <form onSubmit={handleSendResetEmail} autoComplete="off" className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Registered Teacher Gmail Address *
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter the Gmail address you registered with"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSendingResetEmail}
                  className="w-full py-3 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {isSendingResetEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending Reset Email...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      <span>Send Password Reset Email</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyAndResetPassword} autoComplete="off" className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Teacher Gmail Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-300 outline-none transition"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      6-Digit Verification Code (from Email) *
                    </label>
                    <button
                      type="button"
                      onClick={handleSendResetEmail}
                      disabled={isSendingResetEmail}
                      className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                    >
                      Resend Email
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={7}
                    autoComplete="one-time-code"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="Enter 6-digit code (e.g. 482910)"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-emerald-500 px-3.5 py-2.5 text-base font-mono tracking-widest text-emerald-300 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    New Password (min 6 characters) *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Create your new password"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Confirm New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSigningIn}
                  className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {isSigningIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Resetting Password...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify Code &amp; Reset Password</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        ) : (
          /* SIGN IN & REGISTER FORM */
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  {mode === 'signin' ? 'Password *' : 'Create Password (min 6 characters) *'}
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
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
        )}
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
