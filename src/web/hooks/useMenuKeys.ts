import { useEffect } from 'react';

interface UseMenuKeysOptions {
  count: number;
  active: number;
  setActive: (next: number) => void;
  onSelect: (active: number) => void;
  onBack?: () => void;
  // When true, the global keyboard handlers are suppressed (e.g. while a
  // modal is open). Default: false.
  disabled?: boolean;
}

// Shared keyboard handler for vertical menus. Listens at the window level so
// the screen doesn't need its own focus traps. j/Down moves down, k/Up moves
// up, Enter selects, Esc / Backspace goes back.
export function useMenuKeys({
  count,
  active,
  setActive,
  onSelect,
  onBack,
  disabled = false,
}: UseMenuKeysOptions): void {
  useEffect(() => {
    if (disabled || count <= 0) return;
    function onKey(e: KeyboardEvent) {
      // Don't intercept while the user is typing in an input.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setActive(Math.min(count - 1, active + 1));
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setActive(Math.max(0, active - 1));
          break;
        case 'Enter':
          e.preventDefault();
          onSelect(active);
          break;
        case 'Escape':
        case 'Backspace':
          if (onBack) {
            e.preventDefault();
            onBack();
          }
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, active, setActive, onSelect, onBack, disabled]);
}
