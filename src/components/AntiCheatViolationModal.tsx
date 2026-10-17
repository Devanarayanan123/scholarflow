import React from 'react';
import { AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { ViolationLog } from '../types';

interface AntiCheatViolationModalProps {
  isOpen: boolean;
  violation: ViolationLog | null;
  strikesCount?: number;
  maxStrikes?: number;
  onDismiss: () => void;
}

export const AntiCheatViolationModal: React.FC<AntiCheatViolationModalProps> = ({
  isOpen,
  violation,
  onDismiss
}) => {
  if (!isOpen || !violation) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Quiz in Progress</h3>
            <p className="text-xs text-slate-400">Navigation is currently restricted</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-xl border border-slate-800">
          Back navigation and external menu shortcuts are disabled during the session to preserve your current answers. Please finish answering your questions before navigating away.
        </p>

        <button
          type="button"
          onClick={onDismiss}
          className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-semibold text-xs shadow-md shadow-indigo-600/25 flex items-center justify-center gap-2 transition"
        >
          <CheckCircle className="w-4 h-4" />
          <span>Return to Quiz</span>
        </button>
      </div>
    </div>
  );
};
