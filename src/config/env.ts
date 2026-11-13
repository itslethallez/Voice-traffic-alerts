const WAZE_API_KEY = process.env.EXPO_PUBLIC_WAZE_API_KEY;
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const GOOGLE_TTS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_TTS_API_KEY;
const BACKEND_API_URL = process.env.EXPO_PUBLIC_BACKEND_API_URL;

if (!WAZE_API_KEY) {
  console.warn(
    '[env] EXPO_PUBLIC_WAZE_API_KEY is not set. Copy .env.example to .env and add your OpenWeb Ninja API key.'
  );
}

if (!MAPBOX_ACCESS_TOKEN) {
  console.warn(
    '[env] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is not set. Copy .env.example to .env and add your Mapbox public token - the radar map will not render without it.'
  );
}

if (!GOOGLE_TTS_API_KEY) {
  console.warn(
    '[env] EXPO_PUBLIC_GOOGLE_TTS_API_KEY is not set. Copy .env.example to .env and add your Google Cloud Text-to-Speech API key - announcements will fall back to the on-device voice.'
  );
}

if (!BACKEND_API_URL) {
  console.warn(
    '[env] EXPO_PUBLIC_BACKEND_API_URL is not set. Copy .env.example to .env and point it at the deployed server/ API - manual reports will not sync and fixed cameras will fall back to the bundled dataset.'
  );
}

/**
 * `new URL(relativePath, base)` resolves per the WHATWG URL spec: without a
 * trailing slash, the base's last path segment is *replaced* rather than
 * appended to (the same rule as an HTML `<base href>`) - e.g.
 * `new URL('reports', 'https://x/api')` resolves to `https://x/reports`,
 * silently dropping `/api`. wazeApiBaseUrl above is a hardcoded constant
 * that was written with the trailing slash already in place; this one comes
 * from a user-supplied .env value, so it's normalized here rather than
 * trusting whoever sets EXPO_PUBLIC_BACKEND_API_URL to remember it.
 */
function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export const env = {
  wazeApiKey: WAZE_API_KEY ?? '',
  wazeApiBaseUrl: 'https://api.openwebninja.com/waze/',
  mapboxAccessToken: MAPBOX_ACCESS_TOKEN ?? '',
  googleTtsApiKey: GOOGLE_TTS_API_KEY ?? '',
  backendApiBaseUrl: BACKEND_API_URL ? withTrailingSlash(BACKEND_API_URL) : '',
};
