const WAZE_API_KEY = process.env.EXPO_PUBLIC_WAZE_API_KEY;

if (!WAZE_API_KEY) {
  console.warn(
    '[env] EXPO_PUBLIC_WAZE_API_KEY is not set. Copy .env.example to .env and add your OpenWeb Ninja API key.'
  );
}

export const env = {
  wazeApiKey: WAZE_API_KEY ?? '',
  wazeApiBaseUrl: 'https://api.openwebninja.com/waze/',
};
