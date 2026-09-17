/** Shapes returned by server/api/*.ts - see server/schema.sql for the source of truth. */

/** The categories ReportButton.tsx's picker offers - kept separate from
 * WazeAlertType since ROAD_CLOSED/JAM aren't driver-submittable here. */
export type ManualReportCategory = 'POLICE' | 'ACCIDENT' | 'HAZARD';

export interface RemoteManualReport {
  id: string;
  createdAt: string;
  category: string;
  subtype: string | null;
  lat: number;
  lng: number;
  headingDeg: number | null;
  note: string | null;
  confidence: number;
  corroborationCount: number;
  lastConfirmedAt: string;
  /** Only present on the "nearby, from other devices" query
   * (fetchNearbyReports) - whether this device has already confirmed this
   * particular report, so the UI can grey out an already-tapped confirm
   * button instead of re-offering it. Absent (not false) on every other
   * query, since "has this device confirmed it" isn't a meaningful question
   * for your own reports. */
  confirmedByRequester?: boolean;
}

/**
 * One row from GET /api/alerts/nearby (server/lib/postgis-helpers.ts's
 * corridor query): the normalized alert columns from
 * shared/alert-schema.ts field-for-field (snake_case, as the table stores
 * them) plus the driver-relative distance/bearing the corridor math
 * computed server-side.
 */
export interface RemoteCorridorAlert {
  id: string;
  /** A normalized AlertType ('police' | 'traffic' | 'accident' | 'closure'
   * | 'roadkill' | 'hazard') - typed as string so an unexpected value
   * parses and is dropped by the mapper instead of breaking the fetch. */
  type: string;
  lat: number;
  lng: number;
  radius_m: number;
  confidence: number;
  source: string;
  first_seen: string;
  expires_at: string;
  corroboration_count: number;
  distance_m: number;
  bearing_deg: number;
}

export type FixedCameraType = 'fixed' | 'mobile_zone';

export interface RemoteFixedCamera {
  id: string;
  lat: number;
  lng: number;
  roadName: string;
  cameraType: FixedCameraType;
  source: string;
  lastSyncedAt: string;
}
