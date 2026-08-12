import type { WazeAlert, WazeAlertType } from '../types';

/**
 * 20 sample alerts shaped like a real `data.alerts` array from
 * GET https://api.openwebninja.com/waze/alerts-and-jams, so the rest of
 * the app (geo utils, the polling/filtering engine, speech) can be built
 * and tested offline before Step 9 wires up the live API.
 *
 * All 20 are placed relative to a fixed reference driver position and
 * heading (see MOCK_DRIVER below) so the set exercises the exact
 * boundaries the filtering engine cares about: the 300m-2000m distance
 * window, the 45-degree bearing-from-heading window, and the 30-minute
 * staleness window. Ages are computed relative to import time, so the
 * "how many minutes old" relationship stays correct no matter when the
 * fixture is loaded. The coordinate math below is a flat-earth
 * approximation good enough for authoring fixture data - it is not the
 * app's real distance/bearing implementation, which lands in Step 3.
 */

export const MOCK_DRIVER = {
  latitude: 37.7749,
  longitude: -122.4194,
  /** Heading due north */
  heading: 0,
};

const METERS_PER_DEGREE_LAT = 111_320;

function offsetPosition(distanceMeters: number, bearingDegrees: number) {
  const bearingRad = (bearingDegrees * Math.PI) / 180;
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LAT * Math.cos((MOCK_DRIVER.latitude * Math.PI) / 180);

  return {
    latitude:
      MOCK_DRIVER.latitude + (distanceMeters * Math.cos(bearingRad)) / METERS_PER_DEGREE_LAT,
    longitude:
      MOCK_DRIVER.longitude + (distanceMeters * Math.sin(bearingRad)) / metersPerDegreeLon,
  };
}

interface MockAlertSpec {
  id: string;
  type: WazeAlertType;
  subtype: string | null;
  /** Distance ahead of MOCK_DRIVER, in meters, along `bearingFromDriver`. */
  distanceMeters: number;
  /** Bearing from MOCK_DRIVER in degrees, 0 = due north (same as its heading). */
  bearingFromDriver: number;
  ageMinutes: number;
  street: string;
  numThumbsUp: number;
  alertReliability: number;
  alertConfidence: number;
  note: string;
}

const SPECS: MockAlertSpec[] = [
  { id: 'wm-001', type: 'POLICE', subtype: null, distanceMeters: 800, bearingFromDriver: 10, ageMinutes: 3, street: 'Van Ness Ave', numThumbsUp: 4, alertReliability: 8, alertConfidence: 3, note: 'ahead, in range, fresh - should announce' },
  { id: 'wm-002', type: 'ACCIDENT', subtype: 'ACCIDENT_MAJOR', distanceMeters: 1400, bearingFromDriver: -20, ageMinutes: 12, street: 'Market St', numThumbsUp: 12, alertReliability: 9, alertConfidence: 5, note: 'ahead, in range, past 10 min - needs "reported X minutes ago"' },
  { id: 'wm-003', type: 'HAZARD', subtype: 'HAZARD_ON_ROAD_OBJECT', distanceMeters: 500, bearingFromDriver: 40, ageMinutes: 1, street: 'Folsom St', numThumbsUp: 2, alertReliability: 6, alertConfidence: 2, note: 'ahead, bearing just inside the 45 degree window' },
  { id: 'wm-004', type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_EVENT', distanceMeters: 1900, bearingFromDriver: 5, ageMinutes: 25, street: 'Mission St', numThumbsUp: 6, alertReliability: 7, alertConfidence: 4, note: 'near the 2000m edge, still under 30 min' },
  { id: 'wm-005', type: 'JAM', subtype: 'JAM_HEAVY_TRAFFIC', distanceMeters: 3000, bearingFromDriver: 0, ageMinutes: 5, street: 'US-101 N', numThumbsUp: 3, alertReliability: 7, alertConfidence: 2, note: 'too far away (> 2000m) - excluded by distance' },
  { id: 'wm-006', type: 'POLICE', subtype: null, distanceMeters: 150, bearingFromDriver: 0, ageMinutes: 2, street: 'Hayes St', numThumbsUp: 1, alertReliability: 5, alertConfidence: 1, note: 'too close (< 300m) - excluded by distance' },
  { id: 'wm-007', type: 'ACCIDENT', subtype: null, distanceMeters: 1000, bearingFromDriver: 90, ageMinutes: 4, street: 'Geary Blvd', numThumbsUp: 5, alertReliability: 8, alertConfidence: 3, note: 'directly to the side - excluded by bearing' },
  { id: 'wm-008', type: 'HAZARD', subtype: 'HAZARD_ON_ROAD', distanceMeters: 1200, bearingFromDriver: 180, ageMinutes: 6, street: 'Fell St', numThumbsUp: 2, alertReliability: 6, alertConfidence: 2, note: 'directly behind - excluded by bearing' },
  { id: 'wm-009', type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', distanceMeters: 1600, bearingFromDriver: -40, ageMinutes: 40, street: 'Oak St', numThumbsUp: 9, alertReliability: 8, alertConfidence: 4, note: 'stale (> 30 min) - excluded by age' },
  { id: 'wm-010', type: 'JAM', subtype: 'JAM_STAND_STILL_TRAFFIC', distanceMeters: 700, bearingFromDriver: 30, ageMinutes: 15, street: 'Divisadero St', numThumbsUp: 7, alertReliability: 7, alertConfidence: 3, note: 'ahead, in range, past 10 min - needs "reported X minutes ago"' },
  { id: 'wm-011', type: 'POLICE', subtype: null, distanceMeters: 2000, bearingFromDriver: 0, ageMinutes: 0, street: 'Bay St', numThumbsUp: 3, alertReliability: 7, alertConfidence: 2, note: 'exactly at the far distance boundary' },
  { id: 'wm-012', type: 'ACCIDENT', subtype: null, distanceMeters: 300, bearingFromDriver: 0, ageMinutes: 1, street: 'Union St', numThumbsUp: 6, alertReliability: 8, alertConfidence: 4, note: 'exactly at the near distance boundary' },
  { id: 'wm-013', type: 'HAZARD', subtype: 'HAZARD_ON_SHOULDER_CAR_STOPPED', distanceMeters: 1100, bearingFromDriver: 44, ageMinutes: 8, street: 'Chestnut St', numThumbsUp: 2, alertReliability: 6, alertConfidence: 2, note: 'bearing just inside the 45 degree boundary' },
  { id: 'wm-014', type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_EVENT', distanceMeters: 1100, bearingFromDriver: 46, ageMinutes: 8, street: 'Lombard St', numThumbsUp: 4, alertReliability: 7, alertConfidence: 3, note: 'bearing just outside the 45 degree boundary - excluded' },
  { id: 'wm-015', type: 'JAM', subtype: 'JAM_HEAVY_TRAFFIC', distanceMeters: 1300, bearingFromDriver: -45, ageMinutes: 10, street: 'Bush St', numThumbsUp: 5, alertReliability: 7, alertConfidence: 3, note: 'bearing exactly at the 45 degree boundary' },
  { id: 'wm-016', type: 'POLICE', subtype: null, distanceMeters: 900, bearingFromDriver: 15, ageMinutes: 29, street: 'Pine St', numThumbsUp: 8, alertReliability: 9, alertConfidence: 5, note: 'just inside the 30 minute staleness boundary' },
  { id: 'wm-017', type: 'ACCIDENT', subtype: 'ACCIDENT_MINOR', distanceMeters: 900, bearingFromDriver: 15, ageMinutes: 31, street: 'Sutter St', numThumbsUp: 3, alertReliability: 6, alertConfidence: 2, note: 'just outside the 30 minute staleness boundary - excluded' },
  { id: 'wm-018', type: 'HAZARD', subtype: 'HAZARD_ON_ROAD_POT_HOLE', distanceMeters: 600, bearingFromDriver: -10, ageMinutes: 7, street: 'California St', numThumbsUp: 1, alertReliability: 5, alertConfidence: 1, note: 'ahead, in range - should announce' },
  { id: 'wm-019', type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_EVENT', distanceMeters: 1700, bearingFromDriver: 20, ageMinutes: 20, street: 'Clay St', numThumbsUp: 10, alertReliability: 8, alertConfidence: 4, note: 'ahead, in range - should announce' },
  { id: 'wm-020', type: 'JAM', subtype: 'JAM_MODERATE_TRAFFIC', distanceMeters: 250, bearingFromDriver: 5, ageMinutes: 3, street: 'Polk St', numThumbsUp: 2, alertReliability: 6, alertConfidence: 2, note: 'too close (< 300m) - excluded by distance' },
];

function buildAlert(spec: MockAlertSpec, now: number): WazeAlert {
  const { latitude, longitude } = offsetPosition(spec.distanceMeters, spec.bearingFromDriver);
  const publishDate = new Date(now - spec.ageMinutes * 60_000);

  return {
    alert_id: spec.id,
    type: spec.type,
    subtype: spec.subtype,
    reported_by: null,
    description: spec.note,
    image: null,
    publish_datetime_utc: publishDate.toISOString(),
    country: 'US',
    city: 'San Francisco',
    street: spec.street,
    latitude,
    longitude,
    num_thumbs_up: spec.numThumbsUp,
    alert_reliability: spec.alertReliability,
    alert_confidence: spec.alertConfidence,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
}

export function buildMockAlerts(now: number = Date.now()): WazeAlert[] {
  return SPECS.map((spec) => buildAlert(spec, now));
}

export const mockAlerts: WazeAlert[] = buildMockAlerts();
