import { zh } from './catalog/zh.js';
import { en } from './catalog/en.js';
import type { Locale, LocalizedString, MessageCatalog, MessageKey } from './types.js';

const catalogs: Record<Locale, MessageCatalog> = { zh, en };

let activeLocale: Locale = 'zh';
const listeners = new Set<(loc: Locale) => void>();

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(next: Locale): void {
  if (next === activeLocale) return;
  activeLocale = next;
  for (const listener of listeners) listener(next);
}

export function subscribeLocale(listener: (loc: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Interpolate {var} placeholders in the active locale's catalog entry.
// Values may be plain strings/numbers or LocalizedString objects — the
// latter are resolved against the active locale via pickName().
export function t(
  key: MessageKey,
  vars?: Record<string, string | number | LocalizedString>,
): string {
  const catalog = catalogs[activeLocale];
  const raw = catalog[key] ?? catalogs.zh[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined) return `{${name}}`;
    if (typeof v === 'object' && v !== null && 'zh' in v && 'en' in v) {
      return pickName(v);
    }
    return String(v);
  });
}

// Resolve a proper-noun LocalizedString in the active locale.
export function pickName(name: LocalizedString): string {
  return name[activeLocale] || name.zh;
}

// Convenience: list all message keys from the union via the zh catalog.
export function allMessageKeys(): MessageKey[] {
  return Object.keys(zh) as MessageKey[];
}

// Re-export catalogs for tests.
export const catalogsForTesting = { zh, en } as const;
