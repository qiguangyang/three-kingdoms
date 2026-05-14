import React, { useEffect } from 'react';
import { t } from '../../i18n/locale.js';

interface DialogProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  // Show a single Close button (default). For confirmations, render footer
  // content yourself via the `footer` prop.
  footer?: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({ title, children, onClose, footer }) => {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
      <div className="panel w-[min(28rem,90vw)]" role="dialog" aria-modal="true">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">{title}</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ink-divider my-2" />
        <div className="text-sm text-ink-800">{children}</div>
        <div className="mt-3 flex justify-end gap-2">
          {footer ?? (
            <button className="btn" onClick={onClose}>
              {t('app.continue')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
