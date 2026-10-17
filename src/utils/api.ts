import { Exam, Submission } from '../types';

export interface TeacherProfile {
  email: string;
  name: string;
  institution: string;
  picture: string;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, null);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // Auth
  getConfig: () =>
    request<{ googleClientId: string; hasRegisteredTeacher: boolean }>('/api/config'),
  getCurrentTeacher: async (): Promise<TeacherProfile | null> => {
    try {
      const data = await request<{ teacher: TeacherProfile }>('/api/auth/me');
      return data.teacher;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  loginWithGmail: async (payload: {
    mode: 'signin' | 'register';
    email: string;
    password: string;
    name?: string;
    institution?: string;
  }) =>
    (await request<{ teacher: TeacherProfile }>('/api/auth/login', {
      method: 'POST',
      body: json(payload)
    })).teacher,
  signInWithGoogle: async (credential: string) =>
    (await request<{ teacher: TeacherProfile }>('/api/auth/google', {
      method: 'POST',
      body: json({ credential })
    })).teacher,
  signOut: () => request('/api/auth/logout', { method: 'POST' }),

  // Teacher data
  listExams: async () => (await request<{ exams: Exam[] }>('/api/teacher/exams')).exams,
  saveExam: async (exam: Exam) =>
    (await request<{ exam: Exam }>(`/api/teacher/exams/${encodeURIComponent(exam.code)}`, {
      method: 'PUT',
      body: json({ exam })
    })).exam,
  deleteExam: (code: string) =>
    request(`/api/teacher/exams/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  listSubmissions: async () =>
    (await request<{ submissions: Submission[] }>('/api/teacher/submissions')).submissions,
  deleteSubmission: (id: string) =>
    request(`/api/teacher/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  generateQuiz: async (payload: Record<string, unknown>) =>
    (await request<{ exam: Exam }>('/api/generate-quiz', {
      method: 'POST',
      body: json(payload)
    })).exam,

  // Student (public quiz link)
  getPublicExam: async (code: string) =>
    (await request<{ exam: Exam }>(`/api/public/exams/${encodeURIComponent(code)}`)).exam,
  submitExam: async (
    code: string,
    body: {
      studentName: string;
      studentRoll: string;
      answers: Record<string, number>;
      timeTakenSeconds: number;
      autoSubmitted: boolean;
    }
  ) =>
    (await request<{ submission: Submission }>(
      `/api/public/exams/${encodeURIComponent(code)}/submit`,
      { method: 'POST', body: json(body) }
    )).submission
};
