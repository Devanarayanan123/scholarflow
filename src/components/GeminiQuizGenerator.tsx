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
  CheckCircle2
} from 'lucide-react';
import { Exam } from '../types';

interface GeminiQuizGeneratorProps {
  teacherEmail: string;
  teacherName?: string;
  onExamGenerated: (exam: Exam) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

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

  const [difficulty, setDifficulty] = useState<'Foundational' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [questionCount, setQuestionCount] = useState<number>(5);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(15);
  const [isGenerating, setIsGenerating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!teacherEmail) {
      onShowToast('Please sign in with your Teacher Gmail account first.', 'error');
      return;
    }

    if (sourceType === 'topic' && !textInput.trim()) {
      onShowToast('Please enter a topic or chapter name.', 'error');
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

    setIsGenerating(true);

    try {
      const payload: any = {
        teacherEmail,
        teacherName,
        sourceType: sourceType === 'file' ? 'document' : sourceType,
        difficulty,
        questionCount,
        pointsPerQuestion: 2,
        timeLimitMinutes: Number(timeLimitMinutes) || 15
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

      onShowToast(`Generated quiz ${data.exam.code} via Gemini (${teacherEmail})`);
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
              Provide a topic, syllabus, YouTube link, or textbook file to create a quiz
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

      {/* Source Type Selector Pills */}
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
            <label className="block text-xs font-semibold text-slate-300">
              {sourceType === 'topic'
                ? '2. Enter Subject, Chapter, or Concept'
                : '2. Paste Course Syllabus or Textbook Text'}
            </label>
            <textarea
              rows={4}
              required
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                sourceType === 'topic'
                  ? 'Enter your subject, topic, or chapter details...'
                  : 'Paste your syllabus units, textbook content, or lecture notes...'
              }
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none leading-relaxed"
            />
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
                placeholder="Paste YouTube video link"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Video Topic or Focus Notes (Optional)
              </label>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Enter video topic or focus area"
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

        {/* Examiner Configuration Controls */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Number of Questions</span>
              </label>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 px-3.5 py-2.5 text-xs sm:text-sm text-slate-200 outline-none"
              >
                <option value={3}>3 Questions</option>
                <option value={5}>5 Questions</option>
                <option value={8}>8 Questions</option>
                <option value={10}>10 Questions</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                <span>Difficulty</span>
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
                <option value={60}>60 Minutes (Fixed)</option>
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
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Quiz</span>
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
