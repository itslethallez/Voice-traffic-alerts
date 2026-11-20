/**
 * HTTP with the timeout enforced by the native HTTP client, not a JS timer.
 *
 * React Native pauses JS timers whenever the app isn't in the foreground
 * (Android JavaTimerManager.onHostPause: no frame callbacks unless a
 * headless task is running) - screen off, or Waze/Maps in front, which is
 * how Shotgun is meant to be used. A `setTimeout(() => controller.abort())`
 * timeout therefore only fires when something else wakes the JS thread,
 * typically the very response it was meant to cut short: a drive test saw
 * a 600ms deadline fire at 1446ms. XMLHttpRequest.timeout is handed to
 * OkHttp's callTimeout on Android, and the native completion event wakes
 * JS like any response does.
 *
 * Quirk this hides: React Native reports a callTimeout as a plain network
 * error (it only flags SocketTimeoutException as a timeout, and callTimeout
 * throws InterruptedIOException), so an error arriving at the deadline is
 * classified as the timeout. Genuine failures (offline, DNS) fail in tens
 * of milliseconds, not at the deadline.
 */

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`request did not complete within ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class RequestFailedError extends Error {
  /** HTTP status, or null for a transport failure (offline, DNS, abort). */
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'RequestFailedError';
    this.status = status;
  }
}

/** An XHR error this close to the timeout (90%) is the timeout itself. */
const TIMEOUT_ERROR_SLACK = 0.9;

export interface NativeTimeoutRequest {
  method: 'GET' | 'POST';
  url: string;
  /** JSON-serialised as the request body; sets Content-Type. */
  jsonBody?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Resolves with the parsed JSON body of a 2xx response. */
export function requestJsonWithNativeTimeout<T>(request: NativeTimeoutRequest): Promise<T> {
  const { method, url, jsonBody, timeoutMs, signal } = request;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RequestFailedError('request aborted', null));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener('abort', onAbort);
    let sentAtMs = 0;

    xhr.open(method, url);
    if (jsonBody !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new RequestFailedError(`request failed with status ${xhr.status}`, xhr.status));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch (error) {
        reject(new RequestFailedError(`unparseable response: ${String(error)}`, xhr.status));
      }
    };
    xhr.ontimeout = () => {
      done();
      reject(new RequestTimeoutError(timeoutMs));
    };
    xhr.onerror = () => {
      done();
      if (Date.now() - sentAtMs >= timeoutMs * TIMEOUT_ERROR_SLACK) {
        reject(new RequestTimeoutError(timeoutMs));
        return;
      }
      reject(new RequestFailedError('request failed (network error)', null));
    };
    xhr.onabort = () => {
      done();
      reject(new RequestFailedError('request aborted', null));
    };
    signal?.addEventListener('abort', onAbort);
    sentAtMs = Date.now();
    xhr.send(jsonBody === undefined ? null : JSON.stringify(jsonBody));
  });
}
