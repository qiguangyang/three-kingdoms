import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';

export interface MenuOption {
  id: string;
  label: MessageKey | string;
  hint?: string;
  disabled?: boolean;
}

interface CommandMenuProps {
  title: MessageKey | string;
  options: MenuOption[];
  onSelect: (id: string) => void;
  onCancel: () => void;
  // Position the menu near an anchor (cursor coordinates in viewport px).
  anchor?: { x: number; y: number };
}

export const CommandMenu: React.FC<CommandMenuProps> = ({
  title,
  options,
  onSelect,
  onCancel,
  anchor,
}) => {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Keyboard nav while the menu is open.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = options[active];
        if (opt && !opt.disabled) onSelect(opt.id);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, options, onCancel, onSelect]);

  // Auto-focus to capture keys.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // When pinned to a cursor anchor, render absolutely at that point.
  // Otherwise render as a centered modal overlay with a backdrop so it
  // can't be hidden by an unfortunate parent flex layout, and so clicks
  // outside dismiss it. The backdrop covers the viewport but lets the
  // panel surface absorb clicks.
  if (anchor) {
    return (
      <div
        ref={rootRef}
        tabIndex={-1}
        className="panel z-30 w-60 outline-none"
        style={{
          position: 'absolute',
          left: anchor.x,
          top: anchor.y,
          boxShadow: '0 12px 30px -8px rgba(60, 30, 15, 0.45)',
        }}
      >
        <Body
          title={title}
          options={options}
          active={active}
          setActive={setActive}
          onSelect={onSelect}
        />
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={rootRef}
        tabIndex={-1}
        className="panel w-[min(28rem,92vw)] max-h-[80vh] overflow-y-auto outline-none"
        style={{ boxShadow: '0 16px 38px -10px rgba(60, 30, 15, 0.5)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <Body
          title={title}
          options={options}
          active={active}
          setActive={setActive}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
};

// Shared inner body for both the anchored and modal variants.
const Body: React.FC<{
  title: MessageKey | string;
  options: MenuOption[];
  active: number;
  setActive: (i: number) => void;
  onSelect: (id: string) => void;
}> = ({ title, options, active, setActive, onSelect }) => (
  <>
    <div className="panel-heading">{resolveLabel(title)}</div>
    <ul className="flex flex-col">
      {options.map((opt, i) => (
        <li
          key={opt.id}
          className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
            i === active ? 'bg-seal-500/15 text-ink-900' : 'text-ink-700'
          } ${opt.disabled ? 'opacity-50' : 'hover:bg-seal-500/10'}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            if (!opt.disabled) onSelect(opt.id);
          }}
        >
          <span>{resolveLabel(opt.label)}</span>
          {opt.hint && <span className="font-mono text-[10px] text-ink-500">{opt.hint}</span>}
        </li>
      ))}
    </ul>
    <div className="mt-2 text-[10px] text-ink-500">↑↓ · ↵ · Esc</div>
  </>
);

function resolveLabel(label: string): string {
  if (label.includes('.') && /^[a-zA-Z]+\./.test(label)) {
    // Looks like a MessageKey; defer to t().
    return t(label as MessageKey);
  }
  return label;
}
