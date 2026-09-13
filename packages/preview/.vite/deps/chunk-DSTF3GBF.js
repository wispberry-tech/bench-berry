import { createSubscriber } from "./chunk-YJ56H3UW.js";

// node_modules/.deno/svelte@5.57.0/node_modules/svelte/src/reactivity/reactive-value.js
var ReactiveValue = class {
  #fn;
  #subscribe;
  /**
   * @param {() => T} fn
   * @param {(update: () => void) => void} onsubscribe
   */
  constructor(fn, onsubscribe) {
    this.#fn = fn;
    this.#subscribe = createSubscriber(onsubscribe);
  }
  get current() {
    this.#subscribe();
    return this.#fn();
  }
};

export { ReactiveValue };
//# sourceMappingURL=chunk-DSTF3GBF.js.map
