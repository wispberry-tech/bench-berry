import {
  effect_tracking,
  get2 as get,
  increment,
  queue_micro_task,
  render_effect,
  source,
  tag,
  untrack,
} from "./chunk-4PRHFUDT.js";
import { true_default } from "./chunk-PRVSSIY5.js";

// node_modules/.deno/svelte@5.57.0/node_modules/svelte/src/reactivity/create-subscriber.js
function createSubscriber(start) {
  let subscribers = 0;
  let version = source(0);
  let stop;
  if (true_default) {
    tag(version, "createSubscriber version");
  }
  return () => {
    if (effect_tracking()) {
      get(version);
      render_effect(() => {
        if (subscribers === 0) {
          stop = untrack(() => start(() => increment(version)));
        }
        subscribers += 1;
        return () => {
          queue_micro_task(() => {
            subscribers -= 1;
            if (subscribers === 0) {
              stop?.();
              stop = void 0;
              increment(version);
            }
          });
        };
      });
    }
  };
}

export { createSubscriber };
//# sourceMappingURL=chunk-YJ56H3UW.js.map
