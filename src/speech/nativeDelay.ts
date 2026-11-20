import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

/**
 * A delay that still ends on time with the screen off.
 *
 * setTimeout can't be trusted there: React Native pauses JS timers
 * whenever the app isn't in the foreground (see api/nativeTimeoutRequest.ts),
 * so the 1.5s gap between briefing items could stretch until the next
 * location fix happened to wake the JS thread. Audio playback is a clock
 * the OS keeps running: expo-audio's didJustFinish is a native event and
 * wakes JS the same way the Google TTS playback-finished events do in a
 * screen-off drive test. So this plays a silent clip of the requested
 * length at volume 0 and resolves on whichever comes first - the clip
 * finishing, or the ordinary timer (foreground, where it's exact).
 *
 * Only used between briefing items, where Shotgun already holds the
 * ducking audio session - so a silent clip keeps other apps ducked through
 * the whole briefing instead of un-ducking for 1.5s between items.
 */
export function nativeDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) {
      resolve();
      return;
    }

    let player: AudioPlayer | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      if (player) {
        try {
          player.pause();
          player.remove();
        } catch {
          // already released
        }
        player = null;
      }
      resolve();
    };

    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish);

    try {
      player = createAudioPlayer({ uri: silentWavDataUri(ms) });
      player.volume = 0;
      player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.didJustFinish || status.error) finish();
      });
      player.play();
    } catch (error) {
      // No player (shouldn't happen) - the JS timer still ends the delay.
      console.warn('[speech] native delay player failed, falling back to the JS timer', error);
    }
  });
}

const SAMPLE_RATE = 8_000;
const wavCache = new Map<number, string>();

/** 8 kHz mono 8-bit PCM silence, as a data URI. 1.5s is ~16kB of base64. */
export function silentWavDataUri(ms: number): string {
  const cached = wavCache.get(ms);
  if (cached) return cached;

  const samples = Math.max(1, Math.round((SAMPLE_RATE * ms) / 1000));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8-bit PCM silence is the midpoint, not 0

  const uri = `data:audio/wav;base64,${base64(bytes)}`;
  wavCache.set(ms, uri);
  return uri;
}

/** Hermes has no btoa (see googleTts.ts's note), so encode by hand. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[triple & 63] : '=';
  }
  return out;
}
