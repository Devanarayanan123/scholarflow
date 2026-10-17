import React from 'react';
import { Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { formatTime } from '../utils/helpers';

interface FloatingExamTimerProps {
  remainingSeconds: number;
  allocatedSeconds: number;
  onSubmitClick: () => void;
}

export const FloatingExamTimer: React.FC<FloatingExamTimerProps> = ({
  remainingSeconds,
  allocatedSeconds,
  onSubmitClick
}) => {
  const isCritical = remainingSeconds <= 60;
  const isPanic = remainingSeconds <= 15;

  // Percentage of time remaining for circular ring
  const percentLeft = allocatedSeconds > 0 ? Math.max(0, Math.min(100, (remainingSeconds / allocatedSeconds) * 100)) : 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentLeft / 100) * circumference;

  return (
    <aside
      aria-label="Floating Exam Countdown"
      className={`fixed top-4 right-4 sm:top-6 sm:right-6 z-50 select-none transition-all duration-300 ${
        isCritical
          ? 'scale-105'
          : 'hover:scale-[1.02]'
      }`}
    >
      <div
        className={`rounded-2xl p-3 sm:p-3.5 backdrop-blur-md shadow-2xl flex items-center gap-3 sm:gap-4 transition-all duration-300 border ${
          isCritical
            ? 'bg-rose-950/95 border-rose-500 ring-4 ring-rose-500/30 shadow-rose-950/80 animate-pulse'
            : 'bg-slate-900/90 border-slate-700/80 shadow-black/50 hover:border-slate-600'
        }`}
      >
        {/* Circular Progress Ring */}
        <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
          <svg className="w-11 h-11 -rotate-90 transform" viewBox="0 0 44 44">
            <circle
              cx="22"
              cy="22"
              r={radius}
              stroke="currentColor"
              strokeWidth="3.5"
              fill="transparent"
              className={isCritical ? 'text-rose-900/60' : 'text-slate-800'}
            />
            <circle
              cx="22"
              cy="22"
              r={radius}
              stroke="currentColor"
              strokeWidth="3.5"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={`transition-all duration-1000 ${
                isCritical ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]' : 'text-emerald-400'
              }`}
            />
          </svg>

          <div className="absolute inset-0 flex items-center justify-center">
            {isCritical ? (
              <AlertTriangle className={`w-4 h-4 text-rose-400 ${isPanic ? 'animate-bounce' : 'animate-pulse'}`} />
            ) : (
              <Clock className="w-4 h-4 text-emerald-400" />
            )}
          </div>
        </div>

        {/* Time Digits & Labels */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            {isCritical ? (
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-300 bg-rose-500/25 px-1.5 py-0.5 rounded border border-rose-500/40 animate-bounce leading-none">
                {isPanic ? '⚠️ Final Seconds!' : '⚠️ Under 60s!'}
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide leading-none">
                Time Remaining
              </span>
            )}
          </div>

          <div
            className={`font-mono font-extrabold text-xl sm:text-2xl leading-none tracking-tight ${
              isCritical
                ? 'text-rose-200 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : 'text-white'
            }`}
          >
            {formatTime(remainingSeconds)}
          </div>

          {isCritical && (
            <p className="text-[10px] font-bold text-rose-300/90 leading-tight">
              Auto-submits at 00:00
            </p>
          )}
        </div>

        {/* Quick Finish Button on Floating Widget */}
        <button
          type="button"
          onClick={onSubmitClick}
          className={`ml-1 px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition shrink-0 shadow-sm ${
            isCritical
              ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
          title="Submit exam now"
        >
          <span>Submit</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </aside>
  );
};
