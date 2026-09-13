// packages/preview/src/main.ts
// Live component preview bundle entry (§4.6), served by the preview vite
// server under base '/preview/' (dev) / './preview/' (build). Reads
// ?story=<file> from the URL, loads the story module through the @stories
// glob, renders it with the framework detected from the host package.json and
// talks to the shell over the §4.6 protocol. Only ever speaks to window.parent.
/// <reference lib="dom" />
import { parsePreviewMessage, type PreviewMessage } from "../protocol.ts";
import { type PreviewFramework, renderStory, unmountActive } from "./renderers.ts";

// Host project package.json (vite alias @pkg -> <projectRoot>/package.json);
// the framework is detected from its dependencies ('vue' > 'react' > 'svelte').
// @ts-ignore — resolved by the berrybench vite plugin
import pkg from "@pkg";

// Minimal local typing for vite's import.meta.glob so this file stays
// deno-checkable; vite provides the real implementation at build time.
declare global {
  interface ImportMeta {
    glob<T = unknown>(
      pattern: string,
      options: { eager: true },
    ): Record<string, T>;
    glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
  }
}

type StoryModule = { default?: unknown; meta?: Record<string, unknown> };

// Eager story registry: story modules are compiled INTO this bundle, so the
// static build resolves them from memory — no runtime module fetches. The
// sandboxed frame has an opaque origin, and fetches on a stock static host
// are cross-origin requests with no ACAO headers (blank canvas). Keys look
// like '/src/components/badge.story.svelte'; snapshot story.file values match
// by stripping the leading '/'.
const mods = import.meta.glob<StoryModule>("@stories/**/*.story.{svelte,tsx}", { eager: true });

interface PkgJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

function detectFramework(pkgJson: PkgJson): PreviewFramework {
  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  if (deps.vue) return "vue";
  if (deps.react) return "react";
  return "svelte";
}

const framework = detectFramework((pkg ?? {}) as PkgJson);
const params = new URLSearchParams(location.search);
// Canvas theme: the shell embeds the preview as ?theme=light|dark; applied
// before first paint so the frame never flashes white in dark mode. The
// shell keeps it in sync afterwards via setTheme messages (no re-render).
const bootTheme = params.get("theme");
if (bootTheme === "light" || bootTheme === "dark") {
  document.documentElement.dataset.theme = bootTheme;
}
let storyId = params.get("story") ?? "";
let currentProps: Record<string, unknown> = {};
// Monotonic render ticket: the newest render() wins. Every continuation (post
// await, mount, ready/error post) bails when a newer render has started, so a
// slow story can never overwrite a fast one that finished after it.
let renderSeq = 0;

const rootEl = document.getElementById("preview-root") ?? document.body;

const info = document.createElement("div");
info.id = "preview-info";
const infoTitle = document.createElement("span");
infoTitle.className = "preview-info-title";
const infoBadge = document.createElement("span");
infoBadge.className = "preview-info-badge";
infoBadge.textContent = framework;
info.append(infoTitle, infoBadge);

const mount = document.createElement("div");
mount.id = "preview-mount";

rootEl.append(info, mount);

function post(msg: PreviewMessage): void {
  window.parent.postMessage(msg, "*");
}

function setError(message: string): void {
  infoTitle.textContent = "Preview error";
  // Framework-aware teardown: unmounting React goes through root.unmount()
  // (never manual DOM wiping), and live svelte/vue instances are unmounted
  // instead of being leaked alongside a wiped container.
  unmountActive();
  post({ type: "error", message });
}

async function render(): Promise<void> {
  const seq = ++renderSeq;
  // Glob keys can be root-relative ('/src/...') or absolute ('/tmp/p4fixture/src/...')
  // depending on alias expansion; match by exact or '/'-anchored suffix.
  const key = Object.keys(mods).find(
    (k) => k === storyId || k === `/${storyId}` || k.endsWith(`/${storyId}`),
  );
  if (key === undefined) {
    setError(`unknown story ${storyId}`);
    return;
  }
  const load = mods[key];
  let mod: StoryModule;
  try {
    // Eager glob: the story module is already in this bundle; the await keeps
    // render's continuation on a microtask so the renderSeq guard still
    // orders concurrent renders while adding no runtime fetch.
    mod = await load;
  } catch (err) {
    if (seq !== renderSeq) return; // a newer render superseded this one
    setError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (seq !== renderSeq) return;
  if (!mod || !mod.default) {
    if (seq !== renderSeq) return;
    setError("story module has no usable default export");
    return;
  }
  try {
    renderStory(mount, mod, framework, currentProps);
  } catch (err) {
    if (seq !== renderSeq) return;
    setError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (seq !== renderSeq) return;
  infoTitle.textContent = (mod.meta?.title as string | undefined) ?? storyId;
  // Ready is posted after EVERY successful commit (the shell handler is
  // idempotent): a throw followed by a fix re-posts ready and clears the
  // shell's error banner; no one-shot gate here.
  post({ type: "ready" });
}

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const msg = parsePreviewMessage(e.data);
  if (!msg) return;
  if (msg.type === "setProps") {
    currentProps = msg.props;
  } else if (msg.type === "setStory") {
    storyId = msg.storyId;
    currentProps = {};
  } else if (msg.type === "setTheme") {
    // Theme-only message: update the canvas and return without re-rendering.
    document.documentElement.dataset.theme = msg.theme;
    return;
  } else {
    return; // ready/error are preview->shell; never expected here
  }
  void render();
});

void render();
