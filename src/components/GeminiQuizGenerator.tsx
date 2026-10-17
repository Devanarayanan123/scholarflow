import React, { useState, useRef } from 'react';
import {
  Sparkles,
  BookOpen,
  Youtube,
  FileText,
  Upload,
  RefreshCw,
  Clock,
  Layers,
  Gauge,
  CheckCircle2,
  Languages,
  Calculator
} from 'lucide-react';
import { Exam } from '../types';
import { MathEquationToolbar } from './MathText';

interface GeminiQuizGeneratorProps {
  teacherEmail: string;
  teacherName?: string;
  onExamGenerated: (exam: Exam) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

export type QuizLanguage =
  | 'Indian English'
  | 'Malayalam'
  | 'Hindi'
  | 'English + Malayalam'
  | 'English + Hindi';

const LANGUAGE_OPTIONS: Array<{ value: QuizLanguage; label: string; badge: string }> = [
  { value: 'Indian English', label: 'Indian English', badge: 'EN-IN' },
  { value: 'Malayalam', label: 'Malayalam (മലയാളം)', badge: 'മലയാളം' },
  { value: 'Hindi', label: 'Hindi (हिन्दी)', badge: 'हिन्दी' },
  { value: 'English + Malayalam', label: 'Bilingual (English + മലയാളം)', badge: 'EN + മ' },
  { value: 'English + Hindi', label: 'Bilingual (English + हिन्दी)', badge: 'EN + हि' }
];

const QUESTION_COUNT_PRESETS = [5, 10, 15, 20, 25, 30, 40, 50];

export const GeminiQuizGenerator: React.FC<GeminiQuizGeneratorProps> = ({
  teacherEmail,
  teacherName,
  onExamGenerated,
  onShowToast
}) => {
  const [sourceType, setSourceType] = useState<'topic' | 'syllabus' | 'youtube' | 'file'>('topic');
  const [textInput, setTextInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    type: string;
    base64: string;
  } | null>(null);

  const [language, setLanguage] = useState<QuizLanguage>('Indian English');
  const [mathMode, setMathMode] = useState<boolean>(false);
  const [difficulty, setDifficulty] = useState<'Foundational' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(15);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleQuestionCountChange = (newCount: number) => {
    const clamped = Math.max(1, Math.min(50, Math.round(Number(newCount) || 5)));
    setQuestionCount(clamped);
    // Automatically scale suggested timer if the teacher picks a larger exam
    if (clamped >= 40 && timeLimitMinutes < 45) setTimeLimitMinutes(60);
    else if (clamped >= 25 && timeLimitMinutes < 30) setTimeLimitMinutes(30);
    else if (clamped >= 15 && timeLimitMinutes < 20) setTimeLimitMinutes(20);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      onShowToast('File must be under 25MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAttachedFile({
        name: file.name,
        type: file.type || 'application/octet-stream',
        base64: reader.result as string
      });
      onShowToast(`Attached ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleInsertLatex = (snippet: string) => {
    setMathMode(true);
    setTextInput((prev) => (prev ? `${prev} ${snippet}` : snippet));
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!teacherEmail) {
      onShowToast('Please sign in with your Teacher Gmail account first.', 'error');
      return;
    }

    if (sourceType === 'topic' && !textInput.trim()) {
      onShowToast('Please enter a topic, subject, or math concept.', 'error');
      return;
    }
    if (sourceType === 'syllabus' && !textInput.trim()) {
      onShowToast('Please paste your syllabus text.', 'error');
      return;
    }
    if (sourceType === 'youtube' && !youtubeUrl.trim()) {
      onShowToast('Please enter a YouTube video URL.', 'error');
      return;
    }
    if (sourceType === 'file' && !attachedFile) {
      onShowToast('Please upload a file or photo.', 'error');
      return;
    }

    const validCount = Math.max(1, Math.min(50, Math.round(Number(questionCount) || 5)));
    setIsGenerating(true);

    try {
      const payload: any = {
        teacherEmail,
        teacherName,
        sourceType: sourceType === 'file' ? 'document' : sourceType,
        difficulty,
        questionCount: validCount,
        pointsPerQuestion: 2,
        timeLimitMinutes: Number(timeLimitMinutes) || 15,
        language,
        mathMode
      };

      if (sourceType === 'topic' || sourceType === 'syllabus') {
        payload.topic = textInput.trim();
        payload.content = textInput.trim();
      } else if (sourceType === 'youtube') {
        payload.url = youtubeUrl.trim();
        payload.topic = textInput.trim();
        payload.content = textInput.trim();
      } else if (sourceType === 'file') {
        payload.fileName = attachedFile?.name;
        payload.fileMimeType = attachedFile?.type;
        payload.fileData = attachedFile?.base64;
        payload.topic = textInput.trim() || attachedFile?.name;
        payload.content = textInput.trim();
      }

      const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Generation failed');
      }

      const data = await response.json();
      if (!data.success || !data.exam) {
        throw new Error('Could not parse generated quiz.');
      }

      onShowToast(
        `Generated ${data.exam.questions.length}-question quiz (${data.exam.code}) in ${language}`
      );
      onExamGenerated(data.exam);
      setTextInput('');
      setYoutubeUrl('');
      setAttachedFile(null);
    } catch (err: any) {
      console.error(err);
      onShowToast(err.message || 'Failed to generate quiz.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-5 sm:p-8 shadow-xl space-y-6 animate-in fade-in duration-200">
      {/* Header & Connected Teacher Gmail Badge */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/90 pb-5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-display font-bold text-white tracking-tight">
              Gemini AI Quiz Generator
            </h2>
            <p className="text-xs text-slate-400">
              Generate up to 50 questions in Malayalam (മലയാളം), Hindi (हिन्दी), Indian English, or Maths with LaTeX Equations
            </p>
          </div>
        </div>

        {/* Active Teacher Gmail Account Indicator for Gemini AI */}
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-emerald-500/30 text-xs self-start md:self-auto">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="leading-tight">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
              Gemini Account
            </span>
            <span className="font-mono text-emerald-300 font-semibold">{teacherEmail}</span>
          </div>
        </div>
      </div>

      {/* Step 1: Material Source */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-300">
          1. Select Material Source
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => setSourceType('topic')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
              sourceType === 'topic'
                ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                : 'bg-slate-950/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span>Topic / Notes</span>
          </button>

          <button
            type="button"
            onClick={() => setSourceType('syllabus')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
              sourceType === 'syllabus'
                ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                : 'bg-slate-950/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Syllabus Text</span>
          </button>

          <button
            type="button"
            onClick={() => setSourceType('youtube')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
              sourceType === 'youtube'
                ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                : 'bg-slate-950/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Youtube className="w-3.5 h-3.5 text-rose-400" />
            <span>YouTube Link</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSourceType('file');
              fileInputRef.current?.click();
            }}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
              sourceType === 'file'
                ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                : 'bg-slate-950/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Textbook / File</span>
          </button>
        </div>
      </div>

      {/* Step 2: Language & Maths Equation Mode */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90">
        <div className="lg:col-span-8 space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Languages className="w-3.5 h-3.5 text-indigo-400" />
            <span>Question Language &amp; Medium</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = language === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLanguage(opt.value)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${
                    active
                      ? 'bg-indigo-600/25 border-indigo-500 text-white shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      active ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {opt.badge}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-2 flex flex-col justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Calculator className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mathematics &amp; Equations</span>
          </label>
          <button
            type="button"
            onClick={() => setMathMode((prev) => !prev)}
            className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 border transition-all ${
              mathMode
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-950 text-emerald-400 border border-emerald-500/30">
                ∑ x²
              </span>
              <span>Maths with Equations</span>
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-extrabold ${
                mathMode ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {mathMode ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.txt,.docx,.md,image/*"
        className="hidden"
      />

      <form onSubmit={handleGenerate} className="space-y-6">
        {/* Topic or Syllabus Input */}
        {(sourceType === 'topic' || sourceType === 'syllabus') && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-300">
                {sourceType === 'topic'
                  ? '2. Enter Subject, Chapter, Language Topic, or Math Concept'
                  : '2. Paste Course Syllabus or Textbook Text'}
              </label>
              <span className="text-[11px] text-slate-400">
                Supports English, മലയാളം, हिन्दी &amp; LaTeX equations ($...$)
              </span>
            </div>
            <textarea
              rows={4}
              required
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                mathMode
                  ? 'e.g., Quadratic Equations, Calculus Derivatives & Integrals, Trigonometry ($\\sin^2\\theta + \\cos^2\\theta = 1$), Matrices, or Linear Equations...'
                  : language === 'Malayalam'
                  ? 'ഉദാഹരണം: കേരള ചരിത്രം, മലയാള വ്യാകരണം, പ്രകാശസംശ്ലേഷണം, അല്ലെങ്കിൽ ഗണിത സമവാക്യങ്ങൾ...'
                  : language === 'Hindi'
                  ? 'उदाहरण: हिंदी व्याकरण, भारतीय इतिहास, प्रकाश संश्लेषण, या द्विघात समीकरण (Quadratic Equations)...'
                  : sourceType === 'topic'
                  ? 'Enter your subject, topic, chapter, or math concept (in English, മലയാളം, or हिन्दी)...'
                  : 'Paste your syllabus units, textbook content, or lecture notes...'
              }
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none leading-relaxed"
            />

            {mathMode && <MathEquationToolbar onInsert={handleInsertLatex} />}
          </div>
        )}

        {/* YouTube Link Input */}
        {sourceType === 'youtube' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                2. YouTube Video URL
              </label>
              <input
                type="url"
                required
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="Paste YouTube lecture or lesson link"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Video Topic or Focus Notes (Optional — English, മലയാളം, or हिन्दी)
              </label>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Optional: Specify focus area or equations to emphasize"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>
          </div>
        )}

        {/* File Input */}
        {sourceType === 'file' && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300">
              2. Upload Textbook, PDF, or Image
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-6 border-2 border-dashed border-slate-800 hover:border-indigo-500/60 rounded-2xl text-center cursor-pointer bg-slate-950/80 hover:bg-slate-950 transition group"
            >
              <Upload className="w-6 h-6 text-indigo-400 mx-auto mb-2 group-hover:scale-110 transition-transform" />
              {attachedFile ? (
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm text-emerald-400 font-semibold">
                    Attached: {attachedFile.name}
                  </p>
                  <p className="text-[11px] text-slate-500">Click to replace file</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm text-slate-300 font-medium">
                    Click to select a PDF, document, or image
                  </p>
                  <p className="text-[11px] text-slate-500">Supports PDF, DOCX, TXT, PNG, JPG</p>
                </div>
              )}
            </div>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Optional: Specify chapter focus or instructions"
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none"
            />
          </div>
        )}

        {/* Examiner Configuration Controls: Question Count up to 50, Difficulty, Timer */}
        <div className="pt-3 border-t border-slate-800/80 space-y-4">
          {/* Number of Questions Range (1 to 50) + Quick Presets */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/90 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span>Number of Questions (Range: 1 to 50)</span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={questionCount}
                  onChange={(e) => handleQuestionCountChange(Number(e.target.value))}
                  className="w-20 rounded-xl bg-slate-900 border border-indigo-500/40 focus:border-indigo-500 px-3 py-1.5 text-center font-mono text-sm font-bold text-indigo-300 outline-none"
                />
                <span className="text-xs text-slate-400 font-semibold">/ 50 Max</span>
              </div>
            </div>

            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={questionCount}
              onChange={(e) => handleQuestionCountChange(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-slate-500 mr-1">Quick select:</span>
              {QUESTION_COUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleQuestionCountChange(preset)}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border transition ${
                    questionCount === preset
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {preset} Qs
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                <span>Difficulty Level</span>
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as any)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-xs sm:text-sm text-slate-200 outline-none"
              >
                <option value="Foundational">Foundational</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Examiner Time Limit</span>
              </label>
              <select
                value={timeLimitMinutes}
                onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-xs sm:text-sm text-slate-200 outline-none"
              >
                <option value={5}>5 Minutes (Fixed)</option>
                <option value={10}>10 Minutes (Fixed)</option>
                <option value={15}>15 Minutes (Fixed)</option>
                <option value={20}>20 Minutes (Fixed)</option>
                <option value={30}>30 Minutes (Fixed)</option>
                <option value={45}>45 Minutes (Fixed)</option>
                <option value={60}>60 Minutes (1 Hour)</option>
                <option value={90}>90 Minutes (1.5 Hours)</option>
                <option value={120}>120 Minutes (2 Hours)</option>
                <option value={180}>180 Minutes (3 Hours)</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isGenerating}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition h-[42px]"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Generating {questionCount} Qs...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate {questionCount} Questions</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
