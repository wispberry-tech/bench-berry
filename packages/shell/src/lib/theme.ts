// packages/shell/src/lib/theme.ts
/// <reference lib="dom" />
// Theme + accent application. Precedence: localStorage > config.theme (from
// the virtual config module) > defaults ('light', 'violet'). `applyTheme`
// writes data-theme / data-accent on <html> and persists to localStorage.
import type { ThemeConfig } from './types.ts';

export type ThemeName = 'light' | 'dark';

export const ACCENTS = ['violet', 'blue', 'green', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_THEME: ThemeName = 'light';
export const DEFAULT_ACCENT = 'violet';

const THEME_KEY = 'berrybench:theme';
const ACCENT_KEY = 'berrybench:accent';

export interface ThemeSettings {
  theme: ThemeName;
  accent: string;
}

/** Read stored overrides; invalid values are ignored. */
export function readStored(): Partial<ThemeSettings> {
  const out: Partial<ThemeSettings> = {};
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme === 'light' || theme === 'dark') out.theme = theme;
    const accent = localStorage.getItem(ACCENT_KEY);
    if (accent && accent.length > 0) out.accent = accent;
  } catch {
    // localStorage unavailable (private mode etc.) — ignore.
  }
  return out;
}

/** Determine the effective theme/accent: localStorage > config > defaults. */
export function initialTheme(cfgTheme?: ThemeConfig): ThemeSettings {
  const stored = readStored();
  const theme = stored.theme ?? cfgTheme?.defaultTheme ?? DEFAULT_THEME;
  const accent = stored.accent ?? cfgTheme?.accent ?? DEFAULT_ACCENT;
  return { theme, accent };
}

/** Apply theme/accent to <html> and persist both to localStorage. */
export function applyTheme(theme: ThemeName, accent: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-accent', accent);
  try {
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // ignore persistence failures
  }
}

/** Flip the theme, apply + persist it, and return the new name. */
export function toggleTheme(current: ThemeName, accent: string): ThemeName {
  const next: ThemeName = current === 'dark' ? 'light' : 'dark';
  applyTheme(next, accent);
  return next;
}

/** True when the accent is one of the token-defined values. */
export function isKnownAccent(accent: string): accent is Accent {
  return (ACCENTS as readonly string[]).includes(accent);
}