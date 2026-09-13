// packages/preview/src/renderers.ts
// Framework-specific story mounting (§4.6). Every render remounts the
// component with the current props. All three frameworks are imported
// statically (repo-wide deps); the active framework is chosen at runtime by
// src/main.ts from the host package.json.
import { type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type Component, createApp, h } from "vue";
import { type Component as SvelteComponent, mount, unmount } from "svelte";

export type PreviewFramework = "svelte" | "react" | "vue";

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

// The most recently mounted instance (framework + container). main.ts's
// setError tears it down via unmountActive() — framework-correctly — instead
// of wiping React's committed DOM (breaking its fiber bookkeeping) or leaking
// live svelte/vue instances.
let activeHandle: { el: HTMLElement; kind: PreviewFramework } | undefined;

/**
 * Tear down the most recently mounted story instance (if any) and clear its
 * container. Each framework has its own teardown so unmounting React goes
 * through root.unmount() (never manual DOM wiping) and vue/svelte instances
 * are unmounted rather than leaked.
 */
export function unmountActive(): void {
  const active = activeHandle;
  activeHandle = undefined;
  if (active === undefined) return;
  const { el, kind } = active;
  switch (kind) {
    case "svelte":
      svelteUnmounts.get(el)?.();
      svelteUnmounts.delete(el);
      break;
    case "react":
      reactRoots.get(el)?.unmount();
      reactRoots.delete(el);
      break;
    case "vue":
      vueApps.get(el)?.unmount();
      vueApps.delete(el);
      break;
  }
  el.replaceChildren();
}

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
  if (
    Ctor === null || Ctor === undefined || (typeof Ctor !== "function" && typeof Ctor !== "object")
  ) {
    throw new Error("story module has no usable default export");
  }
  switch (framework) {
    case "svelte":
      svelteUnmounts.get(el)?.();
      el.replaceChildren();
      const svelteInstance = mount(Ctor as SvelteComponent, { target: el, props });
      svelteUnmounts.set(el, () => unmount(svelteInstance));
      break;
    case "react": {
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
    case "vue":
      vueApps.get(el)?.unmount();
      el.replaceChildren();
      const vueApp = createApp(h(Ctor as Component, props));
      vueApps.set(el, vueApp);
      vueApp.mount(el);
      break;
  }
  activeHandle = { el, kind: framework };
}
