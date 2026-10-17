import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import type { Exam, Question, Submission, SubmissionAnswer } from './src/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

app.use(express.json({ limit: '30mb' }));

// ---------------------------------------------------------------------------
// Persistent storage (JSON file on the server)
// ---------------------------------------------------------------------------
interface TeacherRecord {
  email: string;
  name: string;
  institution: string;
  picture: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number;
}
interface PasswordResetRecord {
  email: string;
  codeSalt: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}
interface SmtpSettings {
  user: string;
  pass: string;
}
interface StoredExam extends Exam {
  ownerEmail: string;
}
interface StoredSubmission extends Submission {
  ownerEmail: string;
}
interface SessionRecord {
  email: string;
  expiresAt: number;
}
interface Database {
  teachers: Record<string, TeacherRecord>;
  sessions: Record<string, SessionRecord>;
  passwordResets: Record<string, PasswordResetRecord>;
  smtp?: SmtpSettings;
  exams: StoredExam[];
  submissions: StoredSubmission[];
}

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'scholarflow-db.json');

function loadDb(): Database {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return {
        teachers: parsed.teachers || {},
        sessions: parsed.sessions || {},
        passwordResets: parsed.passwordResets || {},
        smtp: parsed.smtp || undefined,
        exams: Array.isArray(parsed.exams) ? parsed.exams : [],
        submissions: Array.isArray(parsed.submissions) ? parsed.submissions : []
      };
    }
  } catch (err) {
    console.error('Could not read database file, starting with an empty one:', err);
  }
  return { teachers: {}, sessions: {}, passwordResets: {}, exams: [], submissions: [] };
}

const db = loadDb();

function saveDb(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// ---------------------------------------------------------------------------
// Password hashing & Gmail validation
// ---------------------------------------------------------------------------
function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

const BLOCKED_FAKE_PREFIXES = new Set([
  'fake',
  'test',
  'testing',
  'tester',
  'example',
  'sample',
  'demo',
  'user',
  'admin',
  'administrator',
  'teacher',
  'student',
  'faculty',
  'person',
  'someone',
  'nobody',
  'random',
  'qwerty',
  'asdfgh',
  'zxcvbn',
  'abcdef',
  'abcd',
  'temp',
  'tempmail',
  'dummy',
  'none',
  'null'
]);

/**
 * Validates that an email is a genuine Gmail / Google Workspace address
 * following Google's official username rules (6–30 chars for @gmail.com,
 * letters + digits/dots, no fake/placeholder words or repeating single chars).
 */
function validateGenuineGmail(rawEmail: string): { valid: boolean; reason?: string } {
  const email = rawEmail.trim().toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Please enter a valid Gmail address (e.g., yourname@gmail.com).' };
  }
  const [local, domain] = parts;

  if (domain !== 'gmail.com' && domain !== 'googlemail.com' && !domain.endsWith('.edu') && !domain.endsWith('.ac.in') && !domain.endsWith('.org')) {
    return {
      valid: false,
      reason: 'Please sign in with an official @gmail.com or institutional Google Workspace email.'
    };
  }

  // Google requires Gmail usernames to be 6-30 characters, only letters, numbers, and periods
  if (local.length < 6 || local.length > 30) {
    return {
      valid: false,
      reason: 'Google Gmail usernames must be between 6 and 30 characters long.'
    };
  }
  if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(local)) {
    return {
      valid: false,
      reason: 'Gmail usernames can only contain letters, numbers, and single periods.'
    };
  }
  const stripped = local.replace(/\./g, '');
  if (!/[a-z]/.test(stripped)) {
    return {
      valid: false,
      reason: 'Gmail username must include letters, not only numbers.'
    };
  }
  // Reject repeated single character like "aaaaaa" or obvious fake prefixes
  if (/^(.)\1{4,}$/.test(stripped)) {
    return {
      valid: false,
      reason: 'This Gmail address appears invalid or unverified.'
    };
  }
  const alphaPrefix = stripped.replace(/[0-9]+$/, '');
  if (BLOCKED_FAKE_PREFIXES.has(stripped) || BLOCKED_FAKE_PREFIXES.has(alphaPrefix)) {
    return {
      valid: false,
      reason: 'Fake or placeholder Gmail IDs are not permitted. Please use your genuine Gmail account.'
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Sessions & authentication helpers
// ---------------------------------------------------------------------------
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${
      secure ? '; Secure' : ''
    }`
  );
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, s] of Object.entries(db.sessions)) {
    if (s.expiresAt < now) delete db.sessions[key];
  }
}

function hasAnyRegisteredTeacher(): boolean {
  return Object.keys(db.teachers).length > 0;
}

function getSessionEmail(req: Request): string | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = db.sessions[hashToken(token)];
  if (!session || session.expiresAt < Date.now()) return null;
  if (!db.teachers[session.email]) return null;
  return session.email;
}

interface AuthedRequest extends Request {
  teacherEmail?: string;
}

function requireTeacher(req: AuthedRequest, res: Response, next: NextFunction) {
  const email = getSessionEmail(req);
  if (!email) {
    res.status(401).json({ success: false, message: 'Please sign in with your Teacher Google account.' });
    return;
  }
  req.teacherEmail = email;
  next();
}

const publicTeacher = (t: TeacherRecord) => ({
  email: t.email,
  name: t.name,
  institution: t.institution || '',
  picture: t.picture
});

function stripOwner<T extends { ownerEmail: string }>(item: T): Omit<T, 'ownerEmail'> {
  const { ownerEmail: _owner, ...rest } = item;
  return rest;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const DIFFICULTIES = ['Foundational', 'Intermediate', 'Advanced'] as const;

function sanitizeQuestion(raw: any, idx: number): Question | null {
  if (!raw || typeof raw.q !== 'string' || !raw.q.trim()) return null;
  if (!Array.isArray(raw.options) || raw.options.length < 2) return null;
  const options = raw.options.slice(0, 6).map((o: unknown) => String(o ?? '').trim());
  if (options.some((o: string) => !o)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : `q_${Date.now()}_${idx}`,
    q: raw.q.trim().slice(0, 2000),
    options,
    correctIndex: clampInt(raw.correctIndex, 0, options.length - 1, 0),
    points: clampInt(raw.points, 1, 100, 1),
    explanation: String(raw.explanation ?? '').trim().slice(0, 2000)
  };
}

function generateUniqueCode(prefixSource: string): string {
  const prefix =
    String(prefixSource || 'QUIZ')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 4) || 'QUIZ';
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = `${prefix}-${crypto.randomInt(1000, 10000)}`;
    if (!db.exams.some((e) => e.code === code)) return code;
  }
  return `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function toStudentExam(exam: StoredExam): Exam {
  const publicExam = stripOwner(exam);
  return {
    ...publicExam,
    questions: exam.questions.map((q) => ({
      id: q.id,
      q: q.q,
      options: q.options,
      points: q.points,
      correctIndex: -1,
      explanation: ''
    }))
  };
}

// ---------------------------------------------------------------------------
// Auth & Cloud routes
// ---------------------------------------------------------------------------
app.get('/api/config', (req: Request, res: Response) => {
  let cloudUrl = '';
  const cloudUrlFile = path.join(DATA_DIR, 'cloud-url.txt');

  // 1. Auto-detect public host from request if accessing via a public cloud domain
  const host = (req.get('x-forwarded-host') || req.get('host') || '').trim();
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    cloudUrl = `${proto}://${host}`;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(cloudUrlFile, cloudUrl, 'utf8');
    } catch {}
  }

  // 2. Read saved cloud URL from data/cloud-url.txt
  if (!cloudUrl && fs.existsSync(cloudUrlFile)) {
    try {
      cloudUrl = fs.readFileSync(cloudUrlFile, 'utf8').trim();
    } catch {}
  }

  // 3. Fallback to APP_URL environment variable
  if (!cloudUrl) {
    cloudUrl = (process.env.APP_URL || '').trim();
  }

  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    hasRegisteredTeacher: hasAnyRegisteredTeacher(),
    cloudUrl
  });
});

app.post('/api/config/cloud-url', requireTeacher, (req: AuthedRequest, res: Response) => {
  const url = String(req.body?.cloudUrl || '').trim();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const cloudUrlFile = path.join(DATA_DIR, 'cloud-url.txt');
    fs.writeFileSync(cloudUrlFile, url, 'utf8');
    res.json({ success: true, cloudUrl: url });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Could not save cloud URL.' });
  }
});

/**
 * Multi-Teacher Genuine Google Account Sign-In & Registration:
 * - Each teacher can register their own genuine Gmail account (mode === 'register')
 *   or sign in to their existing account (mode === 'signin').
 * - Entering an unregistered or fake Gmail on Sign In is rejected (never silently creates a fake account).
 * - Each teacher gets an isolated dashboard with only their own quizzes and their own students' results.
 */
app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode === 'register' ? 'register' : 'signin';
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const institution = String(req.body?.institution || '').trim();

    const emailCheck = validateGenuineGmail(rawEmail);
    if (!emailCheck.valid) {
      res.status(400).json({ success: false, message: emailCheck.reason });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Please enter a password of at least 6 characters.'
      });
      return;
    }

    const existing = db.teachers[rawEmail];

    if (mode === 'signin') {
      if (!existing || !existing.passwordHash) {
        res.status(404).json({
          success: false,
          message:
            'No teacher account found for this Gmail address. Switch to "Create Teacher Account" to register your account first.'
        });
        return;
      }

      if (!verifyPassword(password, existing.passwordSalt, existing.passwordHash)) {
        res.status(401).json({
          success: false,
          message: 'Incorrect password for this Teacher Gmail account.'
        });
        return;
      }

      existing.lastLoginAt = Date.now();
    } else {
      // mode === 'register'
      if (existing && existing.passwordHash) {
        res.status(409).json({
          success: false,
          message:
            'This Teacher Gmail account is already registered. Please switch to "Teacher Sign In" and enter your password.'
        });
        return;
      }

      if (!name || name.length < 2) {
        res.status(400).json({
          success: false,
          message: 'Please enter your full name to register your Teacher account.'
        });
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      db.teachers[rawEmail] = {
        email: rawEmail,
        name: name.slice(0, 120),
        institution: institution.slice(0, 160),
        picture: existing?.picture || '',
        passwordSalt: salt,
        passwordHash: hashPassword(password, salt),
        createdAt: existing?.createdAt || Date.now(),
        lastLoginAt: Date.now()
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    pruneExpiredSessions();
    db.sessions[hashToken(token)] = { email: rawEmail, expiresAt: Date.now() + SESSION_TTL_MS };
    saveDb();

    setSessionCookie(req, res, token, SESSION_TTL_MS);
    res.json({ success: true, teacher: publicTeacher(db.teachers[rawEmail]) });
  } catch (err: any) {
    console.error('Teacher sign-in error:', err);
    res.status(500).json({ success: false, message: 'Sign-in failed. Please try again.' });
  }
});

// Optional Google OAuth ID-Token verification (if GOOGLE_CLIENT_ID is set)
app.post('/api/auth/google', async (req: Request, res: Response) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      res.status(400).json({
        success: false,
        message: 'Google OAuth Client ID is not set. Please use the Teacher Gmail Sign-In form.'
      });
      return;
    }

    const credential = String(req.body?.credential || '');
    if (!credential) {
      res.status(400).json({ success: false, message: 'Missing Google credential.' });
      return;
    }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!verifyRes.ok) {
      res.status(401).json({ success: false, message: 'Google could not verify this sign-in.' });
      return;
    }
    const info: any = await verifyRes.json();

    const email = String(info.email || '').toLowerCase();
    const validIssuer = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    const emailVerified = info.email_verified === true || info.email_verified === 'true';
    const notExpired = Number(info.exp) * 1000 > Date.now();

    if (info.aud !== GOOGLE_CLIENT_ID || !validIssuer || !emailVerified || !notExpired || !email) {
      res.status(401).json({ success: false, message: 'Invalid Google sign-in token.' });
      return;
    }

    const existing = db.teachers[email];
    const salt = existing?.passwordSalt || crypto.randomBytes(16).toString('hex');
    db.teachers[email] = {
      email,
      name: String(info.name || existing?.name || email.split('@')[0]),
      institution: existing?.institution || '',
      picture: String(info.picture || existing?.picture || ''),
      passwordSalt: salt,
      passwordHash: existing?.passwordHash || hashPassword(crypto.randomBytes(16).toString('hex'), salt),
      createdAt: existing?.createdAt || Date.now(),
      lastLoginAt: Date.now()
    };

    const token = crypto.randomBytes(32).toString('hex');
    pruneExpiredSessions();
    db.sessions[hashToken(token)] = { email, expiresAt: Date.now() + SESSION_TTL_MS };
    saveDb();

    setSessionCookie(req, res, token, SESSION_TTL_MS);
    res.json({ success: true, teacher: publicTeacher(db.teachers[email]) });
  } catch (err: any) {
    console.error('Google sign-in failed:', err);
    res.status(500).json({ success: false, message: 'Sign-in failed. Please try again.' });
  }
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const email = getSessionEmail(req);
  if (!email) {
    res.status(401).json({ success: false, message: 'Not signed in.' });
    return;
  }
  res.json({ success: true, teacher: publicTeacher(db.teachers[email]) });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    delete db.sessions[hashToken(token)];
    saveDb();
  }
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
});

function getActiveSmtpCredentials(): { user: string; pass: string } | null {
  const envUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const envPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();
  if (envUser && envPass) {
    return { user: envUser, pass: envPass };
  }
  if (db.smtp?.user && db.smtp?.pass) {
    return { user: db.smtp.user.trim(), pass: db.smtp.pass.replace(/\s+/g, '').trim() };
  }
  return null;
}

async function sendPasswordResetEmail(params: {
  toEmail: string;
  teacherName: string;
  resetCode: string;
  resetLink: string;
}): Promise<{ deliveryMethod: 'gmail_smtp' | 'webmail_relay'; previewUrl?: string }> {
  const { toEmail, teacherName, resetCode, resetLink } = params;
  const formattedCode = `${resetCode.slice(0, 3)} ${resetCode.slice(3)}`;

  const subject = `ScholarFlow Password Reset Code: ${resetCode}`;
  const textBody = [
    `Hello ${teacherName || toEmail},`,
    ``,
    `We received a request to reset the password for your ScholarFlow Teacher account (${toEmail}).`,
    ``,
    `Your 6-digit password reset verification code is: ${resetCode}`,
    ``,
    `Or click the link below to reset your password directly:`,
    resetLink,
    ``,
    `This code expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.`
  ].join('\n');

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Inter, Arial, sans-serif; max-width: 540px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
      <div style="margin-bottom: 20px;">
        <span style="background: #4f46e5; color: #ffffff; font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 8px; display: inline-block;">
          ScholarFlow · Teacher Portal
        </span>
      </div>
      <h2 style="margin: 0 0 12px; font-size: 22px; color: #ffffff;">Reset Your Teacher Password</h2>
      <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
        Hello <strong style="color: #ffffff;">${teacherName || toEmail}</strong>,<br/>
        A password reset was requested for your ScholarFlow Teacher Gmail account (<span style="color: #818cf8;">${toEmail}</span>).
      </p>
      <div style="background: #020617; border: 1px solid #334155; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; margin-bottom: 8px;">
          6-Digit Verification Code (Valid for 15 Minutes)
        </div>
        <div style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #34d399;">
          ${formattedCode}
        </div>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${resetLink}" style="background: #4f46e5; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 10px; display: inline-block;">
          Reset Password Now →
        </a>
      </div>
      <p style="margin: 24px 0 0; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 16px;">
        If you did not request this password reset, your account remains secure and no changes have been made.
      </p>
    </div>
  `;

  // 1. Try real Gmail SMTP if credentials are configured
  const smtpCreds = getActiveSmtpCredentials();
  if (smtpCreds) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: smtpCreds.user,
          pass: smtpCreds.pass
        }
      });

      await transporter.sendMail({
        from: `"ScholarFlow Security" <${smtpCreds.user}>`,
        to: toEmail,
        subject,
        text: textBody,
        html: htmlBody
      });

      return { deliveryMethod: 'gmail_smtp' };
    } catch (smtpErr: any) {
      console.warn('Gmail SMTP delivery failed, falling back to Ethereal Webmail Relay:', smtpErr?.message || smtpErr);
    }
  }

  // 2. Send real email via Ethereal SMTP relay and provide the direct webmail inbox preview link
  const testAccount = await nodemailer.createTestAccount();
  const relayTransporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });

  const info = await relayTransporter.sendMail({
    from: `"ScholarFlow Security" <security@scholarflow.edu>`,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
  return {
    deliveryMethod: 'webmail_relay',
    previewUrl: typeof previewUrl === 'string' ? previewUrl : undefined
  };
}

app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
  try {
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const emailCheck = validateGenuineGmail(rawEmail);
    if (!emailCheck.valid) {
      res.status(400).json({ success: false, message: emailCheck.reason });
      return;
    }

    const teacher = db.teachers[rawEmail];
    if (!teacher) {
      res.status(404).json({
        success: false,
        message: 'No registered Teacher account was found for this Gmail address.'
      });
      return;
    }

    const resetCode = String(crypto.randomInt(100000, 1000000));
    const codeSalt = crypto.randomBytes(16).toString('hex');
    db.passwordResets[rawEmail] = {
      email: rawEmail,
      codeSalt,
      codeHash: hashPassword(resetCode, codeSalt),
      expiresAt: Date.now() + RESET_CODE_TTL_MS,
      attempts: 0
    };
    saveDb();

    // Determine public base URL for the reset link inside the email
    const cloudUrlFile = path.join(DATA_DIR, 'cloud-url.txt');
    let baseUrl = '';
    if (fs.existsSync(cloudUrlFile)) {
      try {
        baseUrl = fs.readFileSync(cloudUrlFile, 'utf8').trim();
      } catch {}
    }
    if (!baseUrl) {
      const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000').trim();
      const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
      baseUrl = `${proto}://${host}`;
    }
    const resetLink = `${baseUrl.replace(/\/+$/, '')}/?resetEmail=${encodeURIComponent(rawEmail)}&resetCode=${encodeURIComponent(resetCode)}`;

    const mailResult = await sendPasswordResetEmail({
      toEmail: rawEmail,
      teacherName: teacher.name,
      resetCode,
      resetLink
    });

    res.json({
      success: true,
      email: rawEmail,
      deliveryMethod: mailResult.deliveryMethod,
      emailPreviewUrl: mailResult.previewUrl,
      message:
        mailResult.deliveryMethod === 'gmail_smtp'
          ? `A 6-digit password reset code has been sent to ${rawEmail}. Please check your Gmail inbox.`
          : `Password reset email generated for ${rawEmail}. Click "Open Sent Reset Email" below to view your 6-digit verification code (or configure Gmail SMTP for direct inbox delivery).`
    });
  } catch (err: any) {
    console.error('Forgot password error:', err);
    res.status(500).json({
      success: false,
      message: err?.message || 'Could not send password reset email. Please try again.'
    });
  }
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  try {
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').replace(/\s+/g, '').trim();
    const newPassword = String(req.body?.newPassword || '');

    const teacher = db.teachers[rawEmail];
    if (!teacher) {
      res.status(404).json({
        success: false,
        message: 'No registered Teacher account was found for this Gmail address.'
      });
      return;
    }

    const resetRecord = db.passwordResets[rawEmail];
    if (!resetRecord || resetRecord.expiresAt < Date.now()) {
      delete db.passwordResets[rawEmail];
      saveDb();
      res.status(400).json({
        success: false,
        message: 'Your password reset code has expired or is invalid. Please request a new code.'
      });
      return;
    }

    if (resetRecord.attempts >= 5) {
      delete db.passwordResets[rawEmail];
      saveDb();
      res.status(429).json({
        success: false,
        message: 'Too many incorrect code attempts. Please request a new reset code.'
      });
      return;
    }

    if (!code || !verifyPassword(code, resetRecord.codeSalt, resetRecord.codeHash)) {
      resetRecord.attempts += 1;
      saveDb();
      res.status(401).json({
        success: false,
        message: 'Invalid 6-digit verification code. Please check the email and try again.'
      });
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Your new password must be at least 6 characters long.'
      });
      return;
    }

    // Update teacher's password with a fresh salt
    const newSalt = crypto.randomBytes(16).toString('hex');
    teacher.passwordSalt = newSalt;
    teacher.passwordHash = hashPassword(newPassword, newSalt);
    teacher.lastLoginAt = Date.now();

    // Clear reset record & invalidate any older sessions for this teacher
    delete db.passwordResets[rawEmail];
    for (const [tokenHash, session] of Object.entries(db.sessions)) {
      if (session.email === rawEmail) {
        delete db.sessions[tokenHash];
      }
    }

    // Create a fresh authenticated session
    const token = crypto.randomBytes(32).toString('hex');
    pruneExpiredSessions();
    db.sessions[hashToken(token)] = { email: rawEmail, expiresAt: Date.now() + SESSION_TTL_MS };
    saveDb();

    setSessionCookie(req, res, token, SESSION_TTL_MS);
    res.json({
      success: true,
      teacher: publicTeacher(teacher),
      message: 'Password reset successfully! You are now signed in.'
    });
  } catch (err: any) {
    console.error('Reset password error:', err);
    res.status(500).json({
      success: false,
      message: 'Could not reset password. Please try again.'
    });
  }
});

app.post('/api/auth/configure-smtp', async (req: Request, res: Response) => {
  try {
    const smtpUser = String(req.body?.smtpUser || '').trim().toLowerCase();
    const smtpPass = String(req.body?.smtpPass || '').replace(/\s+/g, '').trim();

    if (!smtpUser || !smtpPass) {
      db.smtp = undefined;
      saveDb();
      res.json({ success: true, hasSmtpConfigured: false, message: 'Cleared custom Gmail SMTP settings.' });
      return;
    }

    // Verify the Gmail SMTP credentials before saving
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.verify();

    db.smtp = { user: smtpUser, pass: smtpPass };
    saveDb();
    res.json({
      success: true,
      hasSmtpConfigured: true,
      smtpUser,
      message: `Verified & saved Gmail SMTP sender (${smtpUser}). Password reset emails will now be delivered directly to Gmail inboxes!`
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      message:
        'Could not verify Gmail SMTP credentials. Make sure you use your Gmail address and a 16-character Google App Password (from myaccount.google.com/apppasswords).'
    });
  }
});

// ---------------------------------------------------------------------------
// Teacher routes (require a verified session)
// ---------------------------------------------------------------------------
app.get('/api/teacher/exams', requireTeacher, (req: AuthedRequest, res: Response) => {
  const exams = db.exams
    .filter((e) => e.ownerEmail === req.teacherEmail)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(stripOwner);
  res.json({ success: true, exams });
});

app.put('/api/teacher/exams/:code', requireTeacher, (req: AuthedRequest, res: Response) => {
  const email = req.teacherEmail!;
  const code = String(req.params.code || '').toUpperCase();
  const incoming = req.body?.exam;
  const idx = db.exams.findIndex((e) => e.code === code);

  if (idx >= 0 && db.exams[idx].ownerEmail !== email) {
    res.status(403).json({ success: false, message: 'You do not own this quiz.' });
    return;
  }
  if (!incoming || !Array.isArray(incoming.questions)) {
    res.status(400).json({ success: false, message: 'Invalid quiz data.' });
    return;
  }

  const questions = incoming.questions
    .map((q: any, i: number) => sanitizeQuestion(q, i))
    .filter(Boolean) as Question[];
  if (questions.length === 0) {
    res.status(400).json({ success: false, message: 'A quiz needs at least one valid question.' });
    return;
  }

  const stored: StoredExam = {
    id: code,
    code,
    ownerEmail: email,
    title: String(incoming.title || 'Untitled Quiz').slice(0, 200),
    subject: String(incoming.subject || '').slice(0, 200),
    description: String(incoming.description || '').slice(0, 1000),
    difficulty: DIFFICULTIES.includes(incoming.difficulty) ? incoming.difficulty : 'Intermediate',
    defaultTimeLimitMinutes: clampInt(incoming.defaultTimeLimitMinutes, 1, 300, 15),
    allowStudentCustomTimer: false,
    shuffleQuestions: incoming.shuffleQuestions !== false,
    shuffleOptions: incoming.shuffleOptions !== false,
    showExplanations: incoming.showExplanations !== false,
    createdAt: idx >= 0 ? db.exams[idx].createdAt : Date.now(),
    questions
  };

  if (idx >= 0) db.exams[idx] = stored;
  else db.exams.unshift(stored);
  saveDb();
  res.json({ success: true, exam: stripOwner(stored) });
});

app.delete('/api/teacher/exams/:code', requireTeacher, (req: AuthedRequest, res: Response) => {
  const code = String(req.params.code || '').toUpperCase();
  const exam = db.exams.find((e) => e.code === code);
  if (!exam || exam.ownerEmail !== req.teacherEmail) {
    res.status(404).json({ success: false, message: 'Quiz not found.' });
    return;
  }
  db.exams = db.exams.filter((e) => e.code !== code);
  db.submissions = db.submissions.filter((s) => !(s.examCode === code && s.ownerEmail === req.teacherEmail));
  saveDb();
  res.json({ success: true });
});

app.get('/api/teacher/submissions', requireTeacher, (req: AuthedRequest, res: Response) => {
  const submissions = db.submissions
    .filter((s) => s.ownerEmail === req.teacherEmail)
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .map(stripOwner);
  res.json({ success: true, submissions });
});

app.delete('/api/teacher/submissions/:id', requireTeacher, (req: AuthedRequest, res: Response) => {
  const before = db.submissions.length;
  db.submissions = db.submissions.filter(
    (s) => !(s.id === req.params.id && s.ownerEmail === req.teacherEmail)
  );
  if (db.submissions.length === before) {
    res.status(404).json({ success: false, message: 'Submission not found.' });
    return;
  }
  saveDb();
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Public student routes (quiz link)
// ---------------------------------------------------------------------------
app.get('/api/public/exams/:code', (req: Request, res: Response) => {
  const code = String(req.params.code || '').toUpperCase();
  const exam = db.exams.find((e) => e.code === code);
  if (!exam) {
    res.status(404).json({
      success: false,
      message: 'Quiz not found. Please check the link or code shared by your teacher.'
    });
    return;
  }
  res.json({ success: true, exam: toStudentExam(exam) });
});

app.post('/api/public/exams/:code/submit', (req: Request, res: Response) => {
  const code = String(req.params.code || '').toUpperCase();
  const exam = db.exams.find((e) => e.code === code);
  if (!exam) {
    res.status(404).json({ success: false, message: 'This quiz is no longer available.' });
    return;
  }

  const studentName = String(req.body?.studentName || '').trim().slice(0, 100);
  const studentRoll = String(req.body?.studentRoll || '').trim().slice(0, 60);
  if (studentName.length < 2 || studentRoll.length < 1) {
    res.status(400).json({ success: false, message: 'Please enter your name and roll number.' });
    return;
  }

  const rawAnswers: Record<string, unknown> =
    req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const allocatedSeconds = exam.defaultTimeLimitMinutes * 60;
  const timeTakenSeconds = clampInt(req.body?.timeTakenSeconds, 1, allocatedSeconds, allocatedSeconds);

  let earnedPoints = 0;
  let totalPoints = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  const answers: SubmissionAnswer[] = exam.questions.map((q) => {
    totalPoints += q.points;
    const raw = rawAnswers[q.id];
    const chosen = raw === null || raw === undefined || raw === '' ? -1 : Number(raw);
    const isAnswered = Number.isInteger(chosen) && chosen >= 0 && chosen < q.options.length;
    const isCorrect = isAnswered && chosen === q.correctIndex;

    if (!isAnswered) skippedCount++;
    else if (isCorrect) {
      correctCount++;
      earnedPoints += q.points;
    } else wrongCount++;

    return {
      questionId: q.id,
      questionText: q.q,
      options: q.options,
      chosenIndex: isAnswered ? chosen : -1,
      correctIndex: q.correctIndex,
      isCorrect,
      points: q.points,
      explanation: q.explanation
    };
  });

  const submission: StoredSubmission = {
    id: `sub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    ownerEmail: exam.ownerEmail,
    examCode: exam.code,
    examTitle: exam.title,
    studentName,
    studentRoll,
    earnedPoints,
    totalPoints,
    percentage: totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0,
    correctCount,
    wrongCount,
    skippedCount,
    timeTakenSeconds,
    allocatedTimeMinutes: exam.defaultTimeLimitMinutes,
    submittedAt: Date.now(),
    autoSubmitted: Boolean(req.body?.autoSubmitted),
    strikesCount: 0,
    integrityStatus: 'Verified Clean',
    violationLogs: [],
    answers
  };

  db.submissions.unshift(submission);
  saveDb();

  const publicSubmission = stripOwner(submission);
  res.json({
    success: true,
    submission: exam.showExplanations ? publicSubmission : { ...publicSubmission, answers: [] }
  });
});

// ---------------------------------------------------------------------------
// Real AI Quiz Generation (Topic, Syllabus, YouTube Video Metadata/Transcript, & Files)
// ---------------------------------------------------------------------------

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const trimmed = rawUrl.trim();
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id ? id.slice(0, 20) : null;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 20);
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) {
        return parts[1].slice(0, 20);
      }
    }
  } catch {
    // Fallback regex
    const m = rawUrl.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

async function fetchYouTubeVideoContext(rawUrl: string): Promise<{
  videoTitle: string;
  authorName: string;
  description: string;
  keywords: string[];
  transcript: string;
}> {
  const videoId = extractYouTubeVideoId(rawUrl);
  const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : rawUrl.trim();

  let videoTitle = '';
  let authorName = '';
  let description = '';
  let keywords: string[] = [];
  let transcript = '';

  // 1. Fetch official YouTube oEmbed metadata (fast & reliable title + channel)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
    );
    if (oembedRes.ok) {
      const oembed: any = await oembedRes.json();
      videoTitle = String(oembed?.title || '').trim();
      authorName = String(oembed?.author_name || '').trim();
    }
  } catch (err) {
    console.warn('YouTube oEmbed lookup warning:', err);
  }

  // 2. Fetch YouTube watch page to extract full description, topic keywords, and closed captions
  if (videoId) {
    try {
      const watchRes = await fetch(canonicalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      if (watchRes.ok) {
        const html = await watchRes.text();

        if (!videoTitle) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            videoTitle = decodeHtmlEntities(titleMatch[1].replace(/\s*-\s*YouTube$/i, '').trim());
          }
        }

        const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
        if (descMatch) {
          try {
            description = JSON.parse(`"${descMatch[1]}"`).slice(0, 4000);
          } catch {
            description = descMatch[1].replace(/\\n/g, '\n').slice(0, 4000);
          }
        }

        const kwMatch = html.match(/"keywords":\[([^\]]+)\]/);
        if (kwMatch) {
          try {
            keywords = JSON.parse(`[${kwMatch[1]}]`).map((k: unknown) => String(k));
          } catch {}
        }

        // Extract closed-caption transcript track if available
        const captionMatch = html.match(/"captionTracks":\[(\{[^\]]+\})\]/);
        if (captionMatch) {
          try {
            const tracks = JSON.parse(`[${captionMatch[1]}]`);
            const enTrack =
              tracks.find((t: any) => String(t?.languageCode || '').startsWith('en')) || tracks[0];
            if (enTrack?.baseUrl) {
              const capRes = await fetch(enTrack.baseUrl);
              if (capRes.ok) {
                const capXml = await capRes.text();
                const lines = Array.from(capXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)).map((m) =>
                  decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').trim())
                );
                transcript = lines.filter(Boolean).join(' ').slice(0, 6000);
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('YouTube page scrape warning:', err);
    }
  }

  return { videoTitle, authorName, description, keywords, transcript };
}

async function fetchWikipediaContext(topic: string): Promise<string> {
  const clean = topic.trim().slice(0, 120);
  if (!clean || clean.length < 2) return '';
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      clean
    )}&utf8=&format=json&srlimit=2`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'ScholarFlowQuizPlatform/1.0' }
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const firstTitle = data?.query?.search?.[0]?.title;
    if (!firstTitle) return '';

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstTitle)}`,
      { headers: { 'User-Agent': 'ScholarFlowQuizPlatform/1.0' } }
    );
    if (!summaryRes.ok) return '';
    const summaryData: any = await summaryRes.json();
    return String(summaryData?.extract || '').slice(0, 2500);
  } catch {
    return '';
  }
}

function extractUploadedFileText(fileName: string, fileMimeType: string, fileData: string): string {
  if (!fileData) return '';
  try {
    const base64Part = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const buf = Buffer.from(base64Part, 'base64');
    const lowerName = (fileName || '').toLowerCase();
    if (
      fileMimeType.startsWith('text/') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.json')
    ) {
      return buf.toString('utf8').slice(0, 8000);
    }
    // Extract readable ASCII text runs from PDF/DOCX buffers
    const rawStr = buf.toString('latin1');
    const matches = rawStr.match(/[A-Za-z0-9 ,.;:'"?!()-]{15,}/g);
    if (matches && matches.length > 0) {
      return matches.join(' ').slice(0, 6000);
    }
  } catch {}
  return '';
}

function parseJsonFromAiResponse(rawText: string): any {
  const trimmed = rawText.trim();
  // Remove markdown ```json ... ``` fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Try extracting the outermost JSON object {...} or array [...]
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    const firstBracket = candidate.indexOf('[');
    const lastBracket = candidate.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      return JSON.parse(candidate.slice(firstBracket, lastBracket + 1));
    }
    throw new Error('Could not parse JSON from AI response');
  }
}

async function generateQuizWithRealAi(params: {
  sourceType: string;
  topic: string;
  content: string;
  url: string;
  fileName: string;
  fileMimeType: string;
  fileData: string;
  difficulty: string;
  count: number;
  points: number;
}): Promise<{
  title: string;
  subject: string;
  description: string;
  questions: Question[];
}> {
  const { sourceType, topic, content, url, fileName, fileMimeType, fileData, difficulty, count, points } = params;

  let subjectTitle = topic.trim();
  let contextBlocks: string[] = [];

  // 1. If source is YouTube, fetch the REAL video title, channel, description, keywords, and transcript
  if (sourceType === 'youtube' && url) {
    const yt = await fetchYouTubeVideoContext(url);
    const effectiveVideoTopic = yt.videoTitle || topic.trim() || 'Educational Video Topic';
    subjectTitle = topic.trim() ? `${topic.trim()} (${yt.videoTitle || 'Video'})` : effectiveVideoTopic;

    if (yt.videoTitle) {
      contextBlocks.push(`YouTube Video Title: ${yt.videoTitle}`);
    }
    if (yt.authorName) {
      contextBlocks.push(`Channel / Instructor: ${yt.authorName}`);
    }
    if (yt.keywords.length > 0) {
      contextBlocks.push(`Video Topic Keywords: ${yt.keywords.slice(0, 25).join(', ')}`);
    }
    if (yt.description) {
      contextBlocks.push(`Video Description & Lecture Notes:\n${yt.description}`);
    }
    if (yt.transcript) {
      contextBlocks.push(`Video Spoken Transcript Excerpt:\n${yt.transcript}`);
    }
    if (content.trim()) {
      contextBlocks.push(`Teacher's Specific Focus Instructions: ${content.trim()}`);
    }
    // Also fetch Wikipedia reference for the video's subject if transcript wasn't available
    if (!yt.transcript && yt.videoTitle) {
      const cleanedTitle = yt.videoTitle
        .replace(/\(.*?\)|\[.*?\]/g, '')
        .replace(/full course|tutorial|lecture|explained|crash course|in \d+ minutes/gi, '')
        .trim();
      const wiki = await fetchWikipediaContext(cleanedTitle);
      if (wiki) contextBlocks.push(`Factual Reference Summary on "${cleanedTitle}":\n${wiki}`);
    }
  } else if (sourceType === 'document' || sourceType === 'file') {
    const cleanFileTitle = (fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    subjectTitle = topic.trim() || cleanFileTitle || 'Document Assessment';
    const extractedText = extractUploadedFileText(fileName, fileMimeType, fileData);
    if (extractedText) {
      contextBlocks.push(`Uploaded Document ("${fileName}") Content:\n${extractedText}`);
    }
    if (content.trim()) {
      contextBlocks.push(`Teacher Instructions / Focus Area:\n${content.trim()}`);
    }
    const wiki = await fetchWikipediaContext(subjectTitle);
    if (wiki) contextBlocks.push(`Reference Context:\n${wiki}`);
  } else {
    // Topic or Syllabus mode
    subjectTitle = topic.trim().split('\n')[0].slice(0, 100) || 'Academic Assessment';
    if (content.trim()) {
      contextBlocks.push(`Provided Topic / Syllabus Material:\n${content.trim().slice(0, 8000)}`);
    }
    const wiki = await fetchWikipediaContext(subjectTitle);
    if (wiki) {
      contextBlocks.push(`Factual Reference Context on "${subjectTitle}":\n${wiki}`);
    }
  }

  const systemPrompt = `You are an expert academic professor and exam designer.
Your task is to generate a genuine, fact-checked, curriculum-accurate multiple-choice quiz strictly about the specific subject/topic provided.

CRITICAL RULES:
1. Every single question MUST test real, specific facts, concepts, formulas, history, definitions, or problem-solving directly about the requested topic.
2. NEVER generate generic meta-questions like "What is the foundational analytical principle governing X?" or "Why is predictive modeling important in X?".
3. If a YouTube video is provided, NEVER ask questions about YouTube as a website/platform—ask questions strictly about the EDUCATIONAL SUBJECT MATTER taught in that video (e.g., its science, math, coding, history, or literature concepts).
4. Vary which option index (0, 1, 2, or 3) is the correct answer across questions.
5. Output ONLY valid JSON matching the exact schema below—no extra commentary.`;

  const userPrompt = `Generate ${count} multiple-choice questions at the "${difficulty}" difficulty level.

Target Subject / Topic: "${subjectTitle}"
Source Mode: ${sourceType}

${contextBlocks.length > 0 ? `Reference Material & Context:\n${contextBlocks.join('\n\n')}\n` : ''}
Return ONLY a valid JSON object with this exact structure:
{
  "title": "Concise, specific academic quiz title for ${subjectTitle}",
  "subject": "Specific subject name",
  "description": "1-sentence summary of the specific concepts tested in this quiz",
  "questions": [
    {
      "q": "Specific, factual multiple-choice question?",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "correctIndex": 0,
      "explanation": "Clear, factual explanation of why the correct option is right and others are wrong."
    }
  ]
}`;

  let parsed: any = null;

  // Attempt 1: If a standard Google Gemini API key (AIza...) is configured in .env, try @google/genai
  const envGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (envGeminiKey.startsWith('AIza')) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: envGeminiKey });
      const geminiRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
        config: { responseMimeType: 'application/json' }
      });
      if (geminiRes.text) {
        parsed = parseJsonFromAiResponse(geminiRes.text);
      }
    } catch (err) {
      console.warn('Gemini SDK call failed, falling back to OpenAI-compatible AI endpoint:', err);
    }
  }

  // Attempt 2: Live OpenAI-compatible LLM inference via Pollinations AI (zero key required, real LLM)
  if (!parsed || !Array.isArray(parsed?.questions) || parsed.questions.length === 0) {
    const aiRes = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!aiRes.ok) {
      throw new Error(`AI service returned HTTP ${aiRes.status}. Please try again.`);
    }

    const aiJson: any = await aiRes.json();
    const rawContent = String(aiJson?.choices?.[0]?.message?.content || '');
    if (!rawContent) {
      throw new Error('AI returned an empty response. Please try again.');
    }
    parsed = parseJsonFromAiResponse(rawContent);
  }

  const rawQuestions: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.questions)
    ? parsed.questions
    : [];

  const questions: Question[] = rawQuestions
    .map((item, idx) => {
      if (!item || typeof item.q !== 'string' || !Array.isArray(item.options) || item.options.length < 2) {
        return null;
      }
      const cleanOptions = item.options.slice(0, 4).map((o: unknown) => String(o ?? '').trim());
      while (cleanOptions.length < 4) {
        cleanOptions.push(`Option ${cleanOptions.length + 1}`);
      }
      const validCorrect = clampInt(item.correctIndex, 0, cleanOptions.length - 1, 0);
      return {
        id: `q_${Date.now()}_${idx}`,
        q: item.q.trim(),
        options: cleanOptions,
        correctIndex: validCorrect,
        points,
        explanation: String(item.explanation || 'Verified correct answer based on the topic material.').trim()
      };
    })
    .filter(Boolean) as Question[];

  if (questions.length === 0) {
    throw new Error('Could not generate valid questions for this topic. Please try again with more detail.');
  }

  return {
    title: String(parsed?.title || subjectTitle).slice(0, 200),
    subject: String(parsed?.subject || subjectTitle).slice(0, 200),
    description: String(
      parsed?.description || `AI-generated ${difficulty} assessment on ${subjectTitle}.`
    ).slice(0, 1000),
    questions
  };
}

app.post('/api/generate-quiz', requireTeacher, async (req: AuthedRequest, res: Response) => {
  const email = req.teacherEmail!;

  try {
    const {
      sourceType = 'topic',
      topic = '',
      content = '',
      url = '',
      fileName = '',
      fileMimeType = '',
      fileData = '',
      difficulty = 'Intermediate',
      questionCount = 5,
      pointsPerQuestion = 2,
      timeLimitMinutes = 15
    } = req.body || {};

    const parsedCount = clampInt(questionCount, 2, 20, 5);
    const parsedPoints = clampInt(pointsPerQuestion, 1, 20, 2);
    const parsedDifficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'Intermediate';

    const generated = await generateQuizWithRealAi({
      sourceType: String(sourceType),
      topic: String(topic || ''),
      content: String(content || ''),
      url: String(url || ''),
      fileName: String(fileName || ''),
      fileMimeType: String(fileMimeType || ''),
      fileData: String(fileData || ''),
      difficulty: parsedDifficulty,
      count: parsedCount,
      points: parsedPoints
    });

    const code = generateUniqueCode(generated.subject || generated.title || 'QUIZ');
    const exam: StoredExam = {
      id: code,
      code,
      ownerEmail: email,
      title: generated.title,
      subject: generated.subject,
      description: generated.description,
      difficulty: parsedDifficulty,
      defaultTimeLimitMinutes: clampInt(timeLimitMinutes, 1, 300, 15),
      allowStudentCustomTimer: false,
      shuffleQuestions: true,
      shuffleOptions: true,
      showExplanations: true,
      createdAt: Date.now(),
      questions: generated.questions
    };

    db.exams.unshift(exam);
    saveDb();
    res.json({ success: true, exam: stripOwner(exam), teacherEmail: email });
  } catch (error: any) {
    console.error('Error generating quiz:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Could not generate quiz. Please check your inputs.'
    });
  }
});

// ---------------------------------------------------------------------------
// Boot (Vite middleware in development, static dist in production)
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const startListening = (portToTry: number) => {
    const server = app.listen(portToTry, '0.0.0.0', () => {
      console.log(`🚀 ScholarFlow running on http://localhost:${portToTry}`);
    });
    server.on('error', (err: any) => {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`⚠️ Port ${portToTry} is already in use, trying port ${portToTry + 1}...`);
        startListening(portToTry + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  };

  startListening(PORT);
}

startServer();
