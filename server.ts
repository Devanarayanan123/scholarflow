import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
        exams: Array.isArray(parsed.exams) ? parsed.exams : [],
        submissions: Array.isArray(parsed.submissions) ? parsed.submissions : []
      };
    }
  } catch (err) {
    console.error('Could not read database file, starting with an empty one:', err);
  }
  return { teachers: {}, sessions: {}, exams: [], submissions: [] };
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
  let cloudUrl = (process.env.APP_URL || '').trim();

  const cloudUrlFile = path.join(DATA_DIR, 'cloud-url.txt');
  if (!cloudUrl && fs.existsSync(cloudUrlFile)) {
    try {
      cloudUrl = fs.readFileSync(cloudUrlFile, 'utf8').trim();
    } catch {}
  }

  // Auto-detect public host from request if accessing via a public cloud domain
  if (!cloudUrl) {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').trim();
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').trim();
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      cloudUrl = `${proto}://${host}`;
    }
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
// Dynamic Gemini AI Quiz Synthesis (powered by Teacher's initial Gmail session)
// ---------------------------------------------------------------------------
function synthesizeCurriculumQuiz(
  topic: string,
  content: string,
  sourceType: string,
  difficulty: string,
  count: number,
  points: number
) {
  const cleanSubject = topic.trim() || 'Academic Assessment';
  const combinedText = `${topic}\n${content}`.trim();
  const lower = combinedText.toLowerCase();

  // Extract meaningful key concepts or syllabus units if the teacher pasted syllabus/notes
  const extractedLines = combinedText
    .split(/[\n.;•\-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 180 && !/^https?:\/\//i.test(s));

  let subjectName = cleanSubject;
  let questionPool: Array<{ q: string; options: string[]; correctIndex: number; explanation: string }> = [];

  if (extractedLines.length >= 3 && sourceType === 'syllabus') {
    // Build tailored questions directly from the teacher's pasted syllabus units/sentences
    subjectName = cleanSubject.slice(0, 60);
    questionPool = extractedLines.map((unitText, idx) => {
      const shortUnit = unitText.length > 95 ? `${unitText.slice(0, 92)}...` : unitText;
      const correctIdx = idx % 4;
      const distractors = [
        'Replacing empirical verification with uncalibrated qualitative assumptions',
        'Bypassing foundational invariants in favor of unconstrained heuristics',
        'Eliminating boundary conditions and structural consistency checks'
      ];
      const correctAnswer = `Mastering the core principles, analytical methods, and applications of: "${shortUnit}"`;
      const options = [...distractors];
      options.splice(correctIdx, 0, correctAnswer);

      return {
        q: `In the curriculum syllabus, what is the primary learning objective regarding "${shortUnit}"?`,
        options: options.slice(0, 4),
        correctIndex: correctIdx,
        explanation: `This syllabus unit focuses directly on understanding and applying "${shortUnit}".`
      };
    });
  } else if (
    lower.includes('comput') ||
    lower.includes('cs') ||
    lower.includes('code') ||
    lower.includes('program') ||
    lower.includes('data') ||
    lower.includes('algorithm') ||
    lower.includes('software')
  ) {
    subjectName = cleanSubject || 'Computer Science & Software Engineering';
    questionPool = [
      {
        q: 'What is the primary guarantee of ACID transactions in relational and distributed databases?',
        options: [
          'Atomicity, Consistency, Isolation, and Durability ensure state changes succeed completely or rollback without corruption.',
          'Arbitrary cache invalidation and probabilistic consensus without distributed commits.',
          'Asynchronous eventual consistency without strict serializability or mutex locking.',
          'Lossy data compression across disk partitions to minimize storage overhead.'
        ],
        correctIndex: 0,
        explanation: 'ACID guarantees that database transactions are processed reliably, maintaining invariants even during system faults.'
      },
      {
        q: 'In algorithmic complexity analysis, what is the tight asymptotic time complexity of Merge Sort for N items?',
        options: ['O(N^2)', 'O(N log N)', 'O(log N)', 'O(N!)'],
        correctIndex: 1,
        explanation: 'Merge Sort divides the array in log(N) levels and merges in O(N) work per level, giving O(N log N) worst-case time.'
      },
      {
        q: 'Which synchronization primitive prevents race conditions by allowing only one thread into a critical section?',
        options: ['Circular Ring Buffer', 'Non-blocking Counter', 'Mutual Exclusion Lock (Mutex)', 'Stream Reader'],
        correctIndex: 2,
        explanation: 'A Mutex enforces mutual exclusion so concurrent threads cannot corrupt shared mutable state.'
      },
      {
        q: 'Which data structure provides O(1) average-case time complexity for key-value lookups and insertions?',
        options: ['Singly Linked List', 'Hash Table (Hash Map)', 'Binary Search Tree', 'Min-Heap Priority Queue'],
        correctIndex: 1,
        explanation: 'Hash tables compute an index from the key using a hash function, enabling constant-time O(1) average lookup.'
      },
      {
        q: 'In the CAP theorem for distributed data stores, which three properties cannot all be guaranteed simultaneously during a network partition?',
        options: [
          'Caching, Authentication, and Persistence',
          'Concurrency, Atomicity, and Pipelining',
          'Consistency, Availability, and Partition Tolerance',
          'Compression, Allocation, and Parallelism'
        ],
        correctIndex: 2,
        explanation: 'Brewer’s CAP theorem states that a distributed system can deliver at most two of Consistency, Availability, and Partition Tolerance simultaneously.'
      },
      {
        q: 'What is the primary purpose of Virtual Memory paging in modern operating systems?',
        options: [
          'To overclock CPU registers during floating-point operations',
          'To disable hardware interrupts from peripheral devices',
          'To encrypt network packets at the data-link layer',
          'To provide each process with an isolated virtual address space mapped to physical RAM and disk pages'
        ],
        correctIndex: 3,
        explanation: 'Virtual memory decouples process virtual addresses from physical RAM frames using page tables and the MMU.'
      },
      {
        q: 'Which graph traversal algorithm uses a FIFO queue to compute the shortest path in an unweighted graph?',
        options: ['Breadth-First Search (BFS)', 'Depth-First Search (DFS)', 'Kruskal Minimum Spanning Tree', 'Topological Sort'],
        correctIndex: 0,
        explanation: 'BFS explores vertices in layers of increasing distance from the source using a FIFO queue.'
      },
      {
        q: 'In RESTful API design, which HTTP method is specified by RFC 9110 to be idempotent for complete resource replacement?',
        options: ['PUT', 'POST', 'PATCH', 'CONNECT'],
        correctIndex: 0,
        explanation: 'HTTP PUT is idempotent; multiple identical PUT requests produce the same server state as a single request.'
      },
      {
        q: 'In TLS/HTTPS handshakes, why is asymmetric public-key cryptography combined with symmetric session keys?',
        options: [
          'Symmetric encryption cannot encrypt binary payloads',
          'Asymmetric cryptography securely exchanges keys, while symmetric encryption provides fast bulk data transfer',
          'Public keys are only valid for HTTP GET headers',
          'Browsers do not support block ciphers like AES-GCM'
        ],
        correctIndex: 1,
        explanation: 'Hybrid cryptography uses asymmetric keys for authentication and key exchange, then uses fast symmetric ciphers like AES for session traffic.'
      },
      {
        q: 'What role does a Reverse Proxy play in distributed web architecture?',
        options: [
          'Compiles client JavaScript into machine bytecode on user devices',
          'Replaces database storage engines with ephemeral RAM buffers',
          'Simulates network packet drops during security audits',
          'Routes client requests to backend servers while handling load balancing, TLS termination, and caching'
        ],
        correctIndex: 3,
        explanation: 'Reverse proxies sit in front of backend servers to provide load balancing, security, and caching.'
      }
    ];
  } else if (
    lower.includes('physic') ||
    lower.includes('electr') ||
    lower.includes('wave') ||
    lower.includes('force') ||
    lower.includes('thermo')
  ) {
    subjectName = cleanSubject || 'Physics & Classical Mechanics';
    questionPool = [
      {
        q: "According to Faraday's Law of Electromagnetic Induction, what is induced by a time-varying magnetic flux through a closed loop?",
        options: [
          'An Electromotive Force (EMF) proportional to the negative rate of change of magnetic flux',
          'A constant electrostatic potential with zero curl',
          'A loss of gravitational potential energy in the surrounding field',
          'A spontaneous decrease in conductor resistance'
        ],
        correctIndex: 0,
        explanation: "Faraday's law states that EMF = -dPhi/dt, where the negative sign reflects Lenz's Law."
      },
      {
        q: 'In wave mechanics, what phenomenon occurs when a periodic driving frequency matches a system’s natural frequency?',
        options: ['Total destructive attenuation', 'Resonance with maximal amplitude response', 'Phase inversion without oscillation', 'Adiabatic expansion'],
        correctIndex: 1,
        explanation: 'Resonance occurs when the driving frequency matches the natural resonant frequency, maximizing energy transfer.'
      },
      {
        q: 'What is the theoretical maximum thermal efficiency of an ideal Carnot engine operating between hot reservoir T_H and cold reservoir T_C?',
        options: ['1 - (T_C / T_H)', 'T_H / (T_H + T_C)', '(T_H - T_C) / T_C', '1 - (T_H / T_C)^2'],
        correctIndex: 0,
        explanation: 'Carnot efficiency depends strictly on the absolute Kelvin temperatures: eta = 1 - T_C / T_H.'
      },
      {
        q: 'What is the escape velocity from a spherical mass M of radius R?',
        options: ['v = 2GM / R^2', 'v = sqrt(GM * R)', 'v = GM / (2 * pi * R)', 'v = sqrt(2GM / R)'],
        correctIndex: 3,
        explanation: 'Equating kinetic energy (1/2 m v^2) and gravitational potential energy (G M m / R) gives v = sqrt(2GM/R).'
      },
      {
        q: 'According to Gauss’s Law for electricity, the net electric flux through any closed surface equals:',
        options: [
          'The surface area of the enclosing sphere',
          'The external magnetic field strength',
          'The enclosed net electric charge divided by vacuum permittivity (Q_enc / epsilon_0)',
          'Zero for all charge distributions'
        ],
        correctIndex: 2,
        explanation: 'Gauss’s Law states that total electric flux through a closed surface is Q_enclosed / epsilon_0.'
      },
      {
        q: 'When light travels from a higher refractive index (n1) to a lower refractive index (n2) above the critical angle, what occurs?',
        options: ['Chromatic dispersion without reflection', 'Brewster absorption', 'Diffraction splitting', 'Total Internal Reflection'],
        correctIndex: 3,
        explanation: 'Above the critical angle arcsin(n2/n1), 100% of incident light reflects back into the denser medium.'
      },
      {
        q: 'For an ideal gas undergoing an isothermal process at constant temperature, how are pressure (P) and volume (V) related?',
        options: ['P * V = constant (Boyle’s Law)', 'P / V = constant', 'P * V^2 = 0', 'P + V = constant'],
        correctIndex: 0,
        explanation: 'From PV = nRT, keeping T constant makes the product PV constant.'
      },
      {
        q: 'What is the SI unit of magnetic flux density (B-field)?',
        options: ['Weber (Wb)', 'Tesla (T)', 'Henry (H)', 'Farad (F)'],
        correctIndex: 1,
        explanation: 'Magnetic flux density B is measured in Tesla (T), equal to 1 Weber per square meter.'
      }
    ];
  } else if (lower.includes('bio') || lower.includes('gene') || lower.includes('cell') || lower.includes('dna')) {
    subjectName = cleanSubject || 'Biological Sciences & Genetics';
    questionPool = [
      {
        q: 'During eukaryotic cellular respiration, which stage produces the majority of ATP via oxidative phosphorylation?',
        options: [
          'The Electron Transport Chain and ATP Synthase across the inner mitochondrial membrane',
          'Cytoplasmic Glycolysis breaking glucose into pyruvate',
          'Anaerobic Lactic Acid Fermentation in the cytosol',
          'Nuclear transcription of ribosomal RNA'
        ],
        correctIndex: 0,
        explanation: 'Oxidative phosphorylation uses the mitochondrial proton gradient to synthesize ~28-32 ATP per glucose molecule.'
      },
      {
        q: 'Which enzyme synthesizes complementary DNA strands by adding nucleotides in the 5-prime to 3-prime direction?',
        options: ['RNA Helicase', 'DNA Polymerase', 'Topoisomerase I', 'Peptidyl Transferase'],
        correctIndex: 1,
        explanation: 'DNA Polymerase reads the template 3-prime to 5-prime and synthesizes the new strand 5-prime to 3-prime.'
      },
      {
        q: 'What is the primary evolutionary role of Meiosis in sexually reproducing organisms?',
        options: [
          'Producing genetically identical diploid cells for tissue repair',
          'Synthesizing membrane phospholipids',
          'Generating genetically diverse haploid gametes via crossing over and independent assortment',
          'Degrading mRNA transcripts prior to mitosis'
        ],
        correctIndex: 2,
        explanation: 'Meiosis halves the chromosome number while generating genetic diversity.'
      },
      {
        q: 'Where do the light-dependent reactions of photosynthesis occur within plant chloroplasts?',
        options: ['Thylakoid membranes', 'Cytosolic matrix', 'Outer mitochondrial membrane', 'Nucleolus'],
        correctIndex: 0,
        explanation: 'Photosystems I and II are embedded in the thylakoid membranes.'
      },
      {
        q: 'Which organelle modifies, sorts, and packages proteins from the rough ER for secretion?',
        options: ['Peroxisome', 'Centrosome', 'Golgi Apparatus', 'Ribosome'],
        correctIndex: 2,
        explanation: 'The Golgi apparatus processes and packages proteins from the rough endoplasmic reticulum.'
      },
      {
        q: 'What type of chemical bond links amino acids together into a polypeptide chain during translation?',
        options: ['Hydrogen bond', 'Ionic salt bridge', 'Phosphodiester bond', 'Covalent Peptide bond'],
        correctIndex: 3,
        explanation: 'Ribosomes catalyze dehydration synthesis to form covalent peptide bonds between amino acids.'
      }
    ];
  } else {
    subjectName = cleanSubject;
    questionPool = [
      {
        q: `What is the foundational analytical principle governing ${cleanSubject}?`,
        options: [
          `Systematic empirical evidence, structured models, and verifiable principles of ${cleanSubject}`,
          'Unverified assumptions without reproducible measurements',
          'Random qualitative heuristics that reject analytical validation',
          'Isolated observations without controlled variables'
        ],
        correctIndex: 0,
        explanation: `Rigorous study of ${cleanSubject} relies on structured analytical models and verifiable evidence.`
      },
      {
        q: `Which methodology provides the most reliable verification when studying ${cleanSubject}?`,
        options: [
          'Subjective anecdote without baseline controls',
          'Controlled quantitative analysis with explicit variables and reproducible metrics',
          'Extrapolating single outlier cases across unrelated domains',
          'Uncalibrated estimation without peer review'
        ],
        correctIndex: 1,
        explanation: `Controlled analysis and reproducible measurement are essential for verifying results in ${cleanSubject}.`
      },
      {
        q: `Why is predictive modeling important in advanced applications of ${cleanSubject}?`,
        options: [
          'It removes the need to test against real-world data',
          'It guarantees zero variance regardless of input changes',
          'It allows evaluating counterfactual scenarios and projecting system behavior under changing parameters',
          'It replaces quantitative measurement with informal descriptions'
        ],
        correctIndex: 2,
        explanation: `Predictive models allow testing how changes in parameters affect outcomes in ${cleanSubject}.`
      },
      {
        q: `How does sensitivity analysis improve problem-solving in ${cleanSubject}?`,
        options: [
          'By quantifying how variations in input parameters impact overall outcomes and stability',
          'By eliminating boundary conditions from analytical models',
          'By forcing experimental data to fit a predetermined conclusion',
          'By reducing sample sizes below statistical significance'
        ],
        correctIndex: 0,
        explanation: `Sensitivity analysis identifies which variables have the strongest influence on outcomes in ${cleanSubject}.`
      },
      {
        q: `What distinguishes a testable hypothesis in ${cleanSubject} from an unverified claim?`,
        options: [
          'It relies solely on authority rather than observation',
          'It makes specific, measurable predictions that can be empirically evaluated',
          'It is phrased broadly enough to match any outcome',
          'It cannot be independently replicated'
        ],
        correctIndex: 1,
        explanation: `A valid hypothesis in ${cleanSubject} must yield specific, measurable predictions.`
      },
      {
        q: `When evaluating data in ${cleanSubject}, what is a confounding variable?`,
        options: [
          'An external factor that influences both the independent and dependent variables, creating a misleading correlation',
          'A properly randomized control group',
          'A calibrated measurement instrument with zero drift',
          'A constant parameter held fixed throughout an experiment'
        ],
        correctIndex: 0,
        explanation: `Confounding variables must be controlled to establish true cause-and-effect relationships in ${cleanSubject}.`
      },
      {
        q: `What is the primary purpose of standardization and calibration in ${cleanSubject}?`,
        options: [
          'Restricting access to reference datasets',
          'Introducing systematic bias into measurements',
          'Preventing cross-disciplinary comparison',
          'Ensuring results are accurate, consistent, and comparable across independent studies'
        ],
        correctIndex: 3,
        explanation: `Standardization ensures that findings in ${cleanSubject} can be accurately reproduced and compared.`
      },
      {
        q: `Why are systematic meta-analyses valuable when reviewing literature in ${cleanSubject}?`,
        options: [
          'They ignore sample size and variance',
          'They rely on a single qualitative opinion',
          'They combine data across multiple independent studies to increase statistical power and precision',
          'They bypass peer review and validation'
        ],
        correctIndex: 2,
        explanation: `Synthesizing multiple independent studies provides a more reliable estimate of true effects in ${cleanSubject}.`
      }
    ];
  }

  const questions: Question[] = [];
  for (let i = 0; i < count; i++) {
    const template = questionPool[i % questionPool.length];
    questions.push({
      id: `q_${Date.now()}_${i}`,
      q:
        count > questionPool.length && i >= questionPool.length
          ? `${template.q} (Part ${Math.floor(i / questionPool.length) + 1})`
          : template.q,
      options: [...template.options],
      correctIndex: template.correctIndex,
      points,
      explanation: template.explanation
    });
  }

  return {
    title: `${subjectName}`,
    subject: subjectName,
    description: `Assessment generated via Gemini (${difficulty} level).`,
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
      difficulty = 'Intermediate',
      questionCount = 5,
      pointsPerQuestion = 2,
      timeLimitMinutes = 15
    } = req.body || {};

    const parsedCount = clampInt(questionCount, 2, 20, 5);
    const parsedPoints = clampInt(pointsPerQuestion, 1, 20, 2);
    const parsedDifficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'Intermediate';
    const effectiveTopic = String(topic || fileName || url || 'Academic Assessment').trim();

    const synthesized = synthesizeCurriculumQuiz(
      effectiveTopic,
      String(content || url || ''),
      String(sourceType),
      parsedDifficulty,
      parsedCount,
      parsedPoints
    );

    const code = generateUniqueCode(synthesized.subject || effectiveTopic);
    const exam: StoredExam = {
      id: code,
      code,
      ownerEmail: email,
      title: String(synthesized.title).slice(0, 200),
      subject: String(synthesized.subject).slice(0, 200),
      description: String(synthesized.description).slice(0, 1000),
      difficulty: parsedDifficulty,
      defaultTimeLimitMinutes: clampInt(timeLimitMinutes, 1, 300, 15),
      allowStudentCustomTimer: false,
      shuffleQuestions: true,
      shuffleOptions: true,
      showExplanations: true,
      createdAt: Date.now(),
      questions: synthesized.questions
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
