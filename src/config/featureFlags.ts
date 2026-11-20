/**
 * In-app turn-by-turn Navigate mode. Off: Shotgun is a co-pilot - Cruise is
 * the whole app, and destination handoff goes to Waze / Google Maps. The
 * navigation code (src/navigation/, route options, corridor and
 * routeHazardScore) stays in place for reuse; only its UI entry points are
 * gated. EXPO_PUBLIC_ENABLE_NAVIGATE=1 turns it back on for a dev build.
 */
export const NAVIGATE_MODE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_NAVIGATE === '1';
