// packages/shell/src/lib/theme.ts
/// <reference lib="dom" />
// Theme application. Dark mode follows the OS via prefers-color-scheme.
// `applyTheme` toggles the .dark class on <html> only — nothing is persisted
// (the OS owns the theme).
export type ThemeName = "light" | "dark";

/** Apply theme to <html>. No persistence: the OS owns the theme. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
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