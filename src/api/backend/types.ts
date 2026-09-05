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
