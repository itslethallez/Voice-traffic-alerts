/**
 * Cancellable sleep. Resolves after `ms`, or immediately once `signal`
 * aborts - it never rejects, so callers just check `signal.aborted`
 * afterward to decide whether they were cut short, rather than needing
 * try/catch for a routine teardown path.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      cleanup();
      resolve();
    }

    signal?.addEventListener('abort', onAbort);
  });
}
