// packages/shell/src/lib/theme.ts
/// <reference lib="dom" />
// Theme + accent application. Dark mode follows the OS via
// prefers-color-scheme; the accent comes from the resolved config.
// `applyTheme` toggles the .dark class and data-accent on <html> only — nothing
// is persisted (theme is OS-managed, accent is config-managed).
export type ThemeName = "light" | "dark";

export const ACCENTS = ["violet", "blue", "green", "rose"] as const;
type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT = "violet";

/** Apply theme/accent to <html>. No persistence: OS owns the theme, config owns the accent. */
export function applyTheme(theme: ThemeName, accent: string): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.setAttribute("data-accent", accent);
}

/** Current theme from the OS preference. */
export function systemTheme(): ThemeName {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Subscribe to OS theme changes; returns an unsubscribe function. */
export function watchSystemTheme(onChange: (t: ThemeName) => void): () => void {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/** True when the accent is one of the token-defined values. */
export function isKnownAccent(accent: string): accent is Accent {
  return (ACCENTS as readonly string[]).includes(accent);
}