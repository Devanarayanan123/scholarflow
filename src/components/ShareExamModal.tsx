import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  ExternalLink,
  MessageSquare,
  Mail,
  ShieldCheck,
  Clock,
  BookOpen,
  QrCode
} from 'lucide-react';
import { Exam } from '../types';
import { copyTextToClipboard, getExamInviteMessage, getExamShareUrl } from '../utils/helpers';

interface ShareExamModalProps {
  isOpen: boolean;
  exam: Exam | null;
  onClose: () => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

export const ShareExamModal: React.FC<ShareExamModalProps> = ({
  isOpen,
  exam,
  onClose,
  onShowToast
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!isOpen || !exam) return null;

  const shareUrl = getExamShareUrl(exam.code);
  const inviteMessage = getExamInviteMessage(exam.title, exam.code, exam.defaultTimeLimitMinutes);

  const handleCopyLink = () => {
    copyTextToClipboard(shareUrl);
    setCopiedLink(true);
    onShowToast('Direct student join link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyInvite = () => {
    copyTextToClipboard(inviteMessage);
    setCopiedInvite(true);
    onShowToast('Formatted exam invitation message copied!');
    setTimeout(() => setCopiedInvite(false), 2500);
  };

  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(inviteMessage);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const handleEmailShare = () => {
    const subject = encodeURIComponent(`Assessment Invitation: ${exam.title} (${exam.code})`);
    const body = encodeURIComponent(inviteMessage);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // Google Chart API QR Code image URL for easy student scanning
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 space-y-5">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Shareable Exam Link</h3>
            <p className="text-xs text-slate-400">Share this direct link with your students</p>
          </div>
        </div>

        {/* Exam Overview Summary */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded border border-indigo-500/20">
              {exam.code}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {exam.defaultTimeLimitMinutes} mins · {exam.questions.length} Questions
            </span>
          </div>
          <h4 className="font-semibold text-sm text-white">{exam.title}</h4>
          <p className="text-xs text-slate-400 line-clamp-1">{exam.description}</p>
        </div>

        {/* Direct Link Input & Copy Button */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
            Direct Student Join Link (Auto-loads Exam)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-xs font-mono text-slate-200 outline-none select-all focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shrink-0 flex items-center gap-1.5 transition active:scale-[0.98]"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
            </button>
          </div>
        </div>

        {/* Quick Social & Classroom Sharing */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <button
            type="button"
            onClick={handleCopyInvite}
            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 flex flex-col items-center justify-center gap-1 transition"
          >
            {copiedInvite ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-indigo-400" />}
            <span className="font-medium text-[11px]">{copiedInvite ? 'Copied' : 'Copy Invite'}</span>
          </button>

          <button
            type="button"
            onClick={handleWhatsAppShare}
            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-xs text-slate-300 flex flex-col items-center justify-center gap-1 transition"
          >
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <span className="font-medium text-[11px]">WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={handleEmailShare}
            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/50 text-xs text-slate-300 flex flex-col items-center justify-center gap-1 transition"
          >
            <Mail className="w-4 h-4 text-indigo-400" />
            <span className="font-medium text-[11px]">Email Link</span>
          </button>

          <button
            type="button"
            onClick={() => setShowQr(!showQr)}
            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 text-xs text-slate-300 flex flex-col items-center justify-center gap-1 transition"
          >
            <QrCode className="w-4 h-4 text-amber-400" />
            <span className="font-medium text-[11px]">{showQr ? 'Hide QR' : 'Show QR'}</span>
          </button>
        </div>

        {/* QR Code Expansion */}
        {showQr && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center text-center space-y-2 animate-in fade-in duration-200">
            <div className="bg-white p-2.5 rounded-xl shadow-lg">
              <img
                src={qrCodeUrl}
                alt={`QR code for ${exam.code}`}
                className="w-36 h-36"
                referrerPolicy="no-referrer"
              />
            </div>
            <p className="text-xs text-slate-400 pt-1">
              Students can scan this QR code with their phone or tablet camera to instantly join <strong>{exam.code}</strong>.
            </p>
          </div>
        )}

        {/* Clean exam note */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 flex items-start gap-2.5">
          <BookOpen className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <span>
            Students opening this link can immediately enter their name and begin taking the quiz with timer synchronization.
          </span>
        </div>
      </div>
    </div>
  );
};
