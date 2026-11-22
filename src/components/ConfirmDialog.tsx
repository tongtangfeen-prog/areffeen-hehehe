import React from 'react';
import { AlertTriangle, Sparkles, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C3554]/40 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white border border-[#DCECFB] shadow-2xl p-6 animate-[fadeIn_160ms_ease-out]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                tone === 'danger'
                  ? 'bg-[#FFEAF0] text-[#C42746]'
                  : 'bg-[#E5F3FF] text-[#2F7CC0]'
              }`}
            >
              {tone === 'danger' ? <AlertTriangle className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </div>
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-[#1C3554]">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-2 rounded-xl text-[#567394] hover:bg-[#EDF6FF] hover:text-[#1C3554] transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[#486687]">{description}</p>

        {details && details.length > 0 && (
          <ul className="mt-3 space-y-1.5 rounded-2xl bg-[#F5FAFF] border border-[#E1EFFB] p-3.5 text-xs text-[#315072]">
            {details.map((line, idx) => (
              <li key={idx} className="leading-relaxed">
                • {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-[#486687] bg-[#F1F7FD] hover:bg-[#E2F0FC] transition-colors whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              tone === 'danger'
                ? 'bg-[#D63653] hover:bg-[#BC2944]'
                : 'bg-[#3B89CC] hover:bg-[#2D75B5]'
            }`}
          >
            {busy ? 'กำลังดำเนินการ...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
