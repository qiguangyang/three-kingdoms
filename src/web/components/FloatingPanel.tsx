import React from 'react';

interface FloatingPanelProps {
  // Header content shown even when collapsed (a short label, optionally an icon).
  title: React.ReactNode;
  // Absolute-position utility classes placing the panel in a map corner,
  // e.g. 'left-3 top-3' or 'right-3 bottom-3'.
  position: string;
  // Collapsed by default so the full-screen map stays unobstructed.
  defaultOpen?: boolean;
  // Width + max-height (with scroll) of the expanded body.
  bodyClass?: string;
  // Which edge the header/body align to — 'right' for right-hand corners so the
  // panel grows inward rather than off-screen.
  align?: 'left' | 'right';
  children: React.ReactNode;
}

// A collapsible panel that floats over the full-screen campaign map. Only the
// header tab shows when collapsed (the default), keeping the map clear; clicking
// it expands the body. Parchment-styled so it stays legible over the dark atlas.
export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  title,
  position,
  defaultOpen = false,
  bodyClass = 'w-72 max-h-[62vh]',
  align = 'left',
  children,
}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div
      className={`pointer-events-auto absolute z-20 flex flex-col ${
        align === 'right' ? 'items-end' : 'items-start'
      } ${position}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md bg-parchment-100/90 px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-lg ring-1 ring-ink-900/15 backdrop-blur transition hover:bg-parchment-50"
      >
        <span className="text-[9px] leading-none text-seal-600">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && (
        <div className={`mt-1 overflow-auto rounded-md shadow-2xl ring-1 ring-ink-900/15 ${bodyClass}`}>
          {children}
        </div>
      )}
    </div>
  );
};
