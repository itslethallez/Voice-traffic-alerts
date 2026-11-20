/**
 * In-app turn-by-turn Navigate mode. Off: Shotgun is a co-pilot - Cruise is
 * the whole app, and destination handoff goes to Waze / Google Maps. The
 * navigation code (src/navigation/, route options, corridor and
 * routeHazardScore) stays in place for reuse; only its UI entry points are
 * gated. EXPO_PUBLIC_ENABLE_NAVIGATE=1 turns it back on for a dev build.
 */
export const NAVIGATE_MODE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_NAVIGATE === '1';

/**
 * Road matching (road/roadContextRuntime.ts): on by default. Kill switch for
 * Mapbox Directions cost or an outage - with it off, every alert is spoken
 * as "nearby, X away" with straight-line distance, and nothing is called
 * "ahead". Set EXPO_PUBLIC_DISABLE_ROAD_MATCHING=1 in the build env.
 */
export const ROAD_MATCHING_ENABLED = process.env.EXPO_PUBLIC_DISABLE_ROAD_MATCHING !== '1';

/**
 * Drive-test builds only: adds dev/briefingFixture.ts's three synthetic
 * alerts to the start-of-trip briefing. Set EXPO_PUBLIC_BRIEFING_FIXTURE=1
 * in the build env; off (and compiled out) otherwise.
 */
export const BRIEFING_FIXTURE_ENABLED = process.env.EXPO_PUBLIC_BRIEFING_FIXTURE === '1';
