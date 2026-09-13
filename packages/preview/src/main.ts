// packages/preview/src/main.ts
// Live component preview bundle entry (§4.6), served by the preview vite
// server under base '/preview/' (dev) / './preview/' (build). Reads
// ?story=<file> from the URL, loads the story module through the @stories
// glob, renders it with the framework detected from the host package.json and
// talks to the shell over the §4.6 protocol. Only ever speaks to window.parent.
/// <reference lib="dom" />
import { parsePreviewMessage, type PreviewMessage } from '../protocol.ts';
import { renderStory, type PreviewFramework } from './renderers.ts';

// Host project package.json (vite alias @pkg -> <projectRoot>/package.json);
// the framework is detected from its dependencies ('vue' > 'react' > 'svelte').
// @ts-ignore — resolved by the berrybench vite plugin
import pkg from '@pkg';

// Minimal local typing for vite's import.meta.glob so this file stays
// deno-checkable; vite provides the real implementation at build time.
declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
  }
}

type StoryModule = { default?: unknown; meta?: Record<string, unknown> };

// Lazy story registry. Keys look like '/src/components/badge.story.svelte';
// snapshot story.file values ('src/...') match by stripping the leading '/'.
const mods = import.meta.glob<StoryModule>('@stories/**/*.story.{svelte,tsx}');

interface PkgJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

function detectFramework(pkgJson: PkgJson): PreviewFramework {
  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  if (deps.vue) return 'vue';
  if (deps.react) return 'react';
  return 'svelte';
}

const framework = detectFramework((pkg ?? {}) as PkgJson);
const params = new URLSearchParams(location.search);
let storyId = params.get('story') ?? '';
let currentProps: Record<string, unknown> = {};
let readySent = false;

const rootEl = document.getElementById('preview-root') ?? document.body;

const info = document.createElement('div');
info.id = 'preview-info';
const infoTitle = document.createElement('span');
infoTitle.className = 'preview-info-title';
const infoBadge = document.createElement('span');
infoBadge.className = 'preview-info-badge';
infoBadge.textContent = framework;
info.append(infoTitle, infoBadge);

const mount = document.createElement('div');
mount.id = 'preview-mount';

rootEl.append(info, mount);

function post(msg: PreviewMessage): void {
  window.parent.postMessage(msg, '*');
}

function setError(message: string): void {
  infoTitle.textContent = 'Preview error';
  mount.replaceChildren();
  post({ type: 'error', message });
}

async function render(): Promise<void> {
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
    mod = await load();
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!mod || !mod.default) {
    setError('story module has no usable default export');
    return;
  }
  try {
    renderStory(mount, mod, framework, currentProps);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    return;
  }
  infoTitle.textContent = (mod.meta?.title as string | undefined) ?? storyId;
  if (!readySent) {
    readySent = true;
    post({ type: 'ready' });
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const msg = parsePreviewMessage(e.data);
  if (!msg) return;
  if (msg.type === 'setProps') {
    currentProps = msg.props;
  } else if (msg.type === 'setStory') {
    storyId = msg.storyId;
    currentProps = {};
  } else {
    return; // ready/error are preview->shell; never expected here
  }
  void render();
});

void render();