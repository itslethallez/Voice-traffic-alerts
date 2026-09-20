import { useNavigationStore } from '../store/useNavigationStore';

/**
 * Real-device performance diagnostics for drive tests.
 *
 * React Native's built-in perf overlay is compiled out of release builds,
 * so a TestFlight drive has no native FPS readout. This sampler is the
 * substitute: a requestAnimationFrame counter (JS-thread frame rate - the
 * thread where RN jank shows first) plus a setInterval drift probe (event
 * loop lag, which catches the queue-starvation class of bug the nav
 * root-cause fix targeted). Emits one console line per window so it shows
 * up in an idevicesyslog capture alongside the [nav]/[trip]/[map] logs.
 *
 * Caveat: jsFps measures the JS thread only. Native render-thread jank
 * (map GL pipeline) won't show here - for that, watch frame pacing in the
 * device itself. But map-follow jank driven by JS-side position updates,
 * state churn or GC pressure WILL depress jsFps, which is the class of
 * problem we've actually been fighting.
 */

const WINDOW_MS = 10_000;
const LAG_PROBE_MS = 250;

let running = false;
let rafId: number | null = null;
let frames = 0;
let lagSumMs = 0;
let lagMaxMs = 0;
let lagSamples = 0;
let lagTimerId: ReturnType<typeof setTimeout> | null = null;
let reportTimerId: ReturnType<typeof setInterval> | null = null;
let lastLagProbeAt = 0;

function frameTick() {
  frames += 1;
  rafId = requestAnimationFrame(frameTick);
}

function lagProbe() {
  const now = Date.now();
  const drift = now - lastLagProbeAt - LAG_PROBE_MS;
  if (drift > 0) {
    lagSumMs += drift;
    lagSamples += 1;
    if (drift > lagMaxMs) lagMaxMs = drift;
  }
  lastLagProbeAt = now;
  lagTimerId = setTimeout(lagProbe, LAG_PROBE_MS);
}

function report() {
  const fps = Math.round(frames / (WINDOW_MS / 1000));
  const avgLag = lagSamples > 0 ? Math.round(lagSumMs / lagSamples) : 0;
  const navStatus = useNavigationStore.getState().status;
  console.log(
    `[perf] jsFps=${fps} loopLagAvg=${avgLag}ms loopLagMax=${lagMaxMs}ms nav=${navStatus}`
  );
  frames = 0;
  lagSumMs = 0;
  lagMaxMs = 0;
  lagSamples = 0;
}

/** Idempotent - safe to call from every map mount. */
export function startPerfMonitor(): void {
  if (running) return;
  running = true;
  frames = 0;
  lagSumMs = 0;
  lagMaxMs = 0;
  lagSamples = 0;
  rafId = requestAnimationFrame(frameTick);
  lastLagProbeAt = Date.now();
  lagTimerId = setTimeout(lagProbe, LAG_PROBE_MS);
  reportTimerId = setInterval(report, WINDOW_MS);
  console.log('[perf] monitor started');
}

export function stopPerfMonitor(): void {
  if (!running) return;
  running = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (lagTimerId !== null) clearTimeout(lagTimerId);
  if (reportTimerId !== null) clearInterval(reportTimerId);
  rafId = null;
  lagTimerId = null;
  reportTimerId = null;
}
