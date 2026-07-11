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
    <Dialog
      title={t('digest.heading')}
      onClose={onDismiss}
      // Pass the dismiss button as the footer so Dialog doesn't also render
      // its default "Continue" button — otherwise the modal shows two.
      footer={
        <button className="btn btn-primary" onClick={onDismiss}>
          {t('digest.dismiss')}
        </button>
      }
    >
      <ul className="flex flex-col gap-1 text-sm text-ink-800">
        {entries.map((entry, i) => {
          // objective.completed carries its title in vars.title as a MessageKey
          // (evaluateObjectives logs def.titleKey so the engine stays
          // locale-agnostic). Resolve that key through t() first, otherwise
          // {title} would interpolate the literal key string. Guarded to this
          // one key so every other entry renders exactly as before.
          const label =
            entry.key === 'objective.completed' && entry.vars
              ? t('objective.completed', {
                  ...entry.vars,
                  title: t(entry.vars.title as MessageKey),
                })
              : t(entry.key as MessageKey, entry.vars);
          return (
            <li key={`${entry.turn}-${i}`} className="flex gap-2">
              <span className="font-mono text-[10px] text-ink-500">
                {entry.year}.{String(entry.month).padStart(2, '0')}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
};
