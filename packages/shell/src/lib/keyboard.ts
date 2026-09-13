// Global key handling + data-copy button behavior, mirroring the mockup shell:
// '/' or Ctrl/Cmd+K opens the palette, and [data-copy] buttons copy to the
// clipboard with a transient 'copied' state. The palette's arrow/enter/esc
// behaviour is owned by bits-ui Command/Dialog (src/Palette.svelte), so the
// only palette keys handled here are the open triggers.
import { CHECK_ICON } from "./markup.ts";

export interface PaletteController {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const FORM_TAG: Record<string, true> = { INPUT: true, SELECT: true, TEXTAREA: true };

/** Global keydown: palette open shortcut ('/' and Ctrl/Cmd+K). */
export function handleGlobalKeydown(e: KeyboardEvent, palette: PaletteController): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (palette.isOpen()) palette.close();
    else palette.open();
    return;
  }
  if (e.key === "/" && !palette.isOpen()) {
    const tag = (e.target as Element | null)?.tagName ?? "";
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!FORM_TAG[tag]) {
      e.preventDefault();
      palette.open();
    }
  }
}

/** ArrowUp/Down/Home/End focus movement over the active view's rail items. */
export function handleRailNavKeydown(e: KeyboardEvent): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const tag = (e.target as Element | null)?.tagName ?? "";
  if (FORM_TAG[tag] || e.metaKey || e.ctrlKey || e.altKey) return;

  const items = Array.from(document.querySelectorAll<HTMLElement>(".view-body .rail .rail-item"));
  if (items.length === 0) return;

  const idx = items.indexOf(document.activeElement as HTMLElement);
  if (idx === -1 && tag !== "BODY") return;

  let next: number;
  if (e.key === "ArrowDown") next = idx === -1 ? 0 : Math.min(idx + 1, items.length - 1);
  else if (e.key === "ArrowUp") next = idx === -1 ? 0 : Math.max(idx - 1, 0);
  else if (e.key === "Home") next = 0;
  else next = items.length - 1;

  e.preventDefault();
  const el = items[next];
  el.focus();
  el.scrollIntoView({ block: "nearest" });
}

const COPIED_MS = 1200;

// Clipboard fallback for contexts without navigator.clipboard.
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    resolve();
  } catch (err) {
    reject(err);
  }
  return promise;
}

/**
 * Click handler for [data-copy] buttons. Copy text comes from `data-copy-text`
 * when present, else from the element referenced by `data-copy` (or the button
 * itself); the button shows a check icon for COPIED_MS.
 */
export function handleCopyClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  const btn = target?.closest<HTMLElement>("[data-copy]");
  if (!btn) return;

  const explicit = btn.getAttribute("data-copy-text");
  let src: HTMLElement | null = btn;
  if (explicit === null) {
    const sel = btn.getAttribute("data-copy");
    src = sel && sel !== "self" ? document.querySelector<HTMLElement>(sel) : btn;
  }
  const text = explicit ?? src?.getAttribute("data-copy-text") ?? src?.textContent?.trim() ?? "";

  const original = btn.innerHTML;
  const flash = (): void => {
    btn.innerHTML = CHECK_ICON;
    setTimeout(() => {
      btn.innerHTML = original;
    }, COPIED_MS);
  };
  copyText(text).then(flash, flash);
}