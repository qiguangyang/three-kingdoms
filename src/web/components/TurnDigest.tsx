import React from 'react';
import type { LogEntry } from '../../engine/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { Dialog } from './Dialog.js';

interface TurnDigestProps {
  entries: LogEntry[];
  onDismiss: () => void;
}

// Shown after the player advances time, when significant world events
// occurred. Renders nothing when there is nothing significant to report.
export const TurnDigest: React.FC<TurnDigestProps> = ({ entries, onDismiss }) => {
  if (entries.length === 0) return null;
  return (
    <Dialog title={t('digest.heading')} onClose={onDismiss}>
      <ul className="flex flex-col gap-1 text-sm text-ink-800">
        {entries.map((entry, i) => (
          <li key={`${entry.turn}-${i}`} className="flex gap-2">
            <span className="font-mono text-[10px] text-ink-500">
              {entry.year}.{String(entry.month).padStart(2, '0')}
            </span>
            <span>{t(entry.key as MessageKey, entry.vars)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={onDismiss}>
          {t('digest.dismiss')}
        </button>
      </div>
    </Dialog>
  );
};
