export type Debounce = { call(): void; cancel(): void };

/** Trailing debounce with an injectable scheduler (so tests drive it with a fake clock). */
export function createDebounce(
  fn: () => void,
  ms: number,
  { schedule, cancel }: { schedule: (fn: () => void, ms: number) => unknown; cancel: (handle: unknown) => void },
): Debounce {
  let handle: unknown = null;
  let pending = false;
  const clear = () => {
    if (pending) cancel(handle);
    pending = false;
    handle = null;
  };
  return {
    call() {
      clear();
      pending = true;
      handle = schedule(() => {
        pending = false;
        handle = null;
        fn();
      }, ms);
    },
    cancel: clear,
  };
}
