const WAZE_API_KEY = process.env.EXPO_PUBLIC_WAZE_API_KEY;
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;

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

export const env = {
  wazeApiKey: WAZE_API_KEY ?? '',
  wazeApiBaseUrl: 'https://api.openwebninja.com/waze/',
  mapboxAccessToken: MAPBOX_ACCESS_TOKEN ?? '',
};
