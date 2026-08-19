const WAZE_API_KEY = process.env.EXPO_PUBLIC_WAZE_API_KEY;
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;

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

export const env = {
  wazeApiKey: WAZE_API_KEY ?? '',
  wazeApiBaseUrl: 'https://api.openwebninja.com/waze/',
  mapboxAccessToken: MAPBOX_ACCESS_TOKEN ?? '',
  elevenLabsApiKey: ELEVENLABS_API_KEY ?? '',
};
