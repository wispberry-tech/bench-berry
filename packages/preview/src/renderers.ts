// packages/preview/src/renderers.ts
// Framework-specific story mounting (§4.6). Every render remounts the
// component with the current props. All three frameworks are imported
// statically (repo-wide deps); the active framework is chosen at runtime by
// src/main.ts from the host package.json.
import { createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApp, h, type Component } from 'vue';
import { mount, unmount, type Component as SvelteComponent } from 'svelte';

export type PreviewFramework = 'svelte' | 'react' | 'vue';

interface SvelteComponentLike {
  new (options: { target: HTMLElement; props: Record<string, unknown> }): unknown;
}

// React 18+ forbids a second createRoot on the same container (warns and
// leaks a root), so each container gets one memoized root, cleared once at
// creation. A per-render key is bumped so props changes remount the component
// (fresh instance) instead of reconciling in place, matching §4.6 semantics.
const reactRoots = new WeakMap<HTMLElement, Root>();
let reactKey = 0;

// Vue refuses a second mount on a container that still has a mounted app, so
// each container's previous app is unmounted before the fresh mount.
const vueApps = new WeakMap<HTMLElement, { unmount(): void }>();

// Svelte 5 has no `new Component()` API: mount()/unmount() pair per render.
const svelteUnmounts = new WeakMap<HTMLElement, () => void>();

/**
 * Clear `el` and mount the story component with `props` for `framework`.
 * Throws when the module has no usable default export.
 */
export function renderStory(
  el: HTMLElement,
  mod: { default?: unknown; meta?: Record<string, unknown> },
  framework: PreviewFramework,
  props: Record<string, unknown>,
): void {
  const Ctor = mod.default;
  if (Ctor === null || Ctor === undefined || (typeof Ctor !== 'function' && typeof Ctor !== 'object')) {
    throw new Error('story module has no usable default export');
  }
  switch (framework) {
    case 'svelte':
      svelteUnmounts.get(el)?.();
      el.replaceChildren();
      const svelteInstance = mount(Ctor as SvelteComponent, { target: el, props });
      svelteUnmounts.set(el, () => unmount(svelteInstance));
      break;
    case 'react': {
      // React owns its container once created — never clear it manually or the
      // mount/fiber bookkeeping breaks (deletion of already-detached nodes).
      let root = reactRoots.get(el);
      if (!root) {
        el.replaceChildren();
        root = createRoot(el);
        reactRoots.set(el, root);
      }
      reactKey += 1;
      root.render(createElement(Ctor as ComponentType, { ...props, key: reactKey }));
      break;
    }
    case 'vue':
      vueApps.get(el)?.unmount();
      el.replaceChildren();
      const vueApp = createApp(h(Ctor as Component, props));
      vueApps.set(el, vueApp);
      vueApp.mount(el);
      break;
  }
}