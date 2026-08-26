const WAZE_API_KEY = process.env.EXPO_PUBLIC_WAZE_API_KEY;
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
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

if (!ELEVENLABS_API_KEY) {
  console.warn(
    '[env] EXPO_PUBLIC_ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your ElevenLabs API key - announcements will fall back to the on-device voice.'
  );
}

if (!BACKEND_API_URL) {
  console.warn(
    '[env] EXPO_PUBLIC_BACKEND_API_URL is not set. Copy .env.example to .env and point it at the deployed server/ API - manual reports will not sync and fixed cameras will fall back to the bundled dataset.'
  );
}

export const env = {
  wazeApiKey: WAZE_API_KEY ?? '',
  wazeApiBaseUrl: 'https://api.openwebninja.com/waze/',
  mapboxAccessToken: MAPBOX_ACCESS_TOKEN ?? '',
  elevenLabsApiKey: ELEVENLABS_API_KEY ?? '',
  backendApiBaseUrl: BACKEND_API_URL ?? '',
};
