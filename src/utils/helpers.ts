import { Exam, Question } from '../types';

export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomizeQuestionOptions(question: Question): Question {
  const indexedOptions = question.options.map((text, idx) => ({
    text,
    isCorrect: idx === question.correctIndex
  }));
  const shuffled = shuffleArray(indexedOptions);
  const newCorrectIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    ...question,
    options: shuffled.map((item) => item.text),
    correctIndex: newCorrectIndex >= 0 ? newCorrectIndex : 0
  };
}

export function copyTextToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
  document.body.removeChild(textArea);
  return success || Boolean(navigator?.clipboard);
}

export function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let configuredCloudUrl: string = '';

export function setConfiguredCloudUrl(url: string | null | undefined) {
  if (url && typeof url === 'string') {
    configuredCloudUrl = url.trim().replace(/\/+$/, '');
  }
}

export function getConfiguredCloudUrl(): string {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('scholarflow_cloud_url');
    if (local && local.trim()) return local.trim().replace(/\/+$/, '');
  }
  if (configuredCloudUrl) return configuredCloudUrl;
  if (typeof window !== 'undefined' && window.location.origin) {
    const origin = window.location.origin;
    if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin.replace(/\/+$/, '');
    }
  }
  return '';
}

export function getExamShareUrl(examCode: string): string {
  const cloudUrl = getConfiguredCloudUrl();
  const base = cloudUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const prefix = base ? base.replace(/\/+$/, '') : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const cleanPath = pathname === '/' ? '' : pathname;
  return `${prefix}${cleanPath}?exam=${encodeURIComponent(examCode)}`;
}

export function getExamInviteMessage(examTitle: string, examCode: string, timeMins: number): string {
  const url = getExamShareUrl(examCode);
  return `📝 Assessment: ${examTitle}\n🔑 Exam Code: ${examCode}\n⏱️ Time Allowed: ${timeMins} minutes\n🔗 Direct Join Link: ${url}`;
}

export function generateGoogleFormsScript(exam: Exam): string {
  const payload = {
    title: exam.title || 'Untitled Academic Assessment',
    description: `Exam Code: ${exam.code} · Time Limit: ${exam.defaultTimeLimitMinutes} mins`,
    shuffleQuestions: Boolean(exam.shuffleQuestions),
    questions: (exam.questions || []).map((q) => ({
      q: q.q,
      options: q.options,
      correctIndex: Number(q.correctIndex),
      points: Number(q.points) || 1,
      explanation: q.explanation || ''
    }))
  };

  const jsonString = JSON.stringify(payload, null, 2);

  return `/**
 * AUTO-GENERATED GOOGLE APPS SCRIPT FOR GOOGLE FORMS
 * Course/Assessment: ${exam.title} (${exam.code})
 *
 * HOW TO DEPLOY:
 * 1. Navigate to https://script.google.com and click "+ New Project"
 * 2. Delete any template code and paste this entire script into Code.gs
 * 3. Click "Run" -> Authorize permissions when prompted once
 * 4. Open the Execution Log at the bottom to find your Live Student Link and Teacher Edit Link!
 */
function createVerifiedAssessmentForm() {
  const examData = ${jsonString};

  // 1. Initialize Google Form configured as an auto-graded Quiz
  const form = FormApp.create(examData.title);
  form.setDescription(examData.description)
      .setIsQuiz(true)
      .setShuffleQuestions(examData.shuffleQuestions)
      .setCollectEmail(false)
      .setProgressBar(true);

  // 2. Candidate Identification Section
  form.addTextItem()
      .setTitle('Student Full Name')
      .setRequired(true);

  form.addTextItem()
      .setTitle('Roll Number / Candidate ID')
      .setRequired(true);

  // Page break ensures identity fields are not shuffled with test questions
  form.addPageBreakItem()
      .setTitle('Assessment Questions')
      .setHelpText('Answer all questions. Option choice order is randomized.');

  // 3. Inject Questions with Points and Answer Key
  examData.questions.forEach((item, index) => {
    const mcItem = form.addMultipleChoiceItem();
    mcItem.setTitle('Q' + (index + 1) + '. ' + item.q)
          .setPoints(item.points || 1)
          .setRequired(true);

    const choices = item.options.map((optText, optIdx) => {
      return mcItem.createChoice(String(optText), optIdx === item.correctIndex);
    });
    mcItem.setChoices(choices);

    if (item.explanation) {
      const feedback = FormApp.createFeedback()
        .setText('Explanation: ' + item.explanation)
        .build();
      mcItem.setFeedbackForCorrect(feedback);
      mcItem.setFeedbackForIncorrect(feedback);
    }
  });

  Logger.log('✅ Google Form Assessment Successfully Created!');
  Logger.log('🔗 Student Exam Link: ' + form.getPublishedUrl());
  Logger.log('🛠️ Teacher Editor Link: ' + form.getEditUrl());
}`;
}
