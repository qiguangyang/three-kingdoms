import React, { useEffect, useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectLocale } from '../../state/selectors.js';
import { loadGame, setScreen } from '../../state/store.js';
import {
  listSlots,
  loadFromSlot,
  saveToSlot,
  type SaveSlot,
} from '../../state/persistence.js';
import { pickName, t } from '../../i18n/locale.js';
import { SCENARIOS } from '../../data/scenarios/index.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

interface Props {
  mode: 'save' | 'load';
}

const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];

export const SaveLoadScreen: React.FC<Props> = ({ mode }) => {
  useSession(selectLocale);
  const game = useSession(selectGame);
  const locale = useSession((s) => s.ui.locale);
  const [slots, setSlots] = useState<SaveSlot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    const onDisk = listSlots();
    const byName = new Map(onDisk.map((s) => [s.slot, s] as const));
    const manuals: SaveSlot[] = MANUAL_SLOTS.map(
      (slot) => byName.get(slot) ?? { slot, key: `tk-save:${slot}`, exists: false },
    );
    const autos = onDisk.filter((s) => s.slot.startsWith('autosave-'));
    setSlots([...manuals, ...autos]);
  }

  function commit(i: number) {
    const sel = slots[i];
    if (!sel) return;
    try {
      if (mode === 'save') {
        if (!game) return;
        saveToSlot(sel.slot, game, locale);
        setMessage(t('save.saved', { path: `localStorage:${sel.slot}` }));
        refresh();
      } else {
        if (!sel.exists) return;
        const file = loadFromSlot(sel.slot);
        loadGame({ game: file.state, locale: file.locale });
        setScreen({ kind: 'main' });
      }
    } catch (err) {
      setMessage(t('save.failed', { error: (err as Error).message }));
    }
  }

  useMenuKeys({
    count: slots.length,
    active,
    setActive,
    onSelect: commit,
    onBack: () => setScreen(game ? { kind: 'main' } : { kind: 'title' }),
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">
          {t('save.heading')} · {mode}
        </h2>
        <button
          className="btn-ghost text-sm"
          onClick={() => setScreen(game ? { kind: 'main' } : { kind: 'title' })}
        >
          {t('app.back')}
        </button>
      </header>
      <ul className="panel divide-y divide-ink-300/30">
        {slots.map((slot, i) => {
          const scName = slot.scenarioId ? SCENARIOS[slot.scenarioId]?.name : undefined;
          return (
            <li
              key={slot.slot}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 ${
                i === active ? 'bg-seal-500/10' : ''
              }`}
              onClick={() => setActive(i)}
              onDoubleClick={() => commit(i)}
            >
              <div>
                <div className="font-serif text-sm font-semibold">
                  {t('save.slot', { slot: slot.slot })}
                </div>
                {slot.exists && (
                  <div className="text-xs text-ink-500">
                    {scName ? pickName(scName) : slot.scenarioId} · {slot.year}.
                    {String(slot.month).padStart(2, '0')} ·{' '}
                    {slot.savedAt?.slice(0, 19) ?? ''}
                  </div>
                )}
                {!slot.exists && <div className="text-xs text-ink-500">{t('save.empty')}</div>}
              </div>
              <button
                className={`btn ${mode === 'save' ? 'btn-primary' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  commit(i);
                }}
                disabled={mode === 'load' && !slot.exists}
              >
                {mode === 'save' ? t('app.confirm') : t('app.continue')}
              </button>
            </li>
          );
        })}
      </ul>
      {message && <div className="panel-tight text-sm text-ink-700">{message}</div>}
      <div className="font-mono text-[10px] text-ink-500">
        ↑↓ / j k · Enter · Esc
      </div>
    </div>
  );
};
