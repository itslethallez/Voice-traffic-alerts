/** Shapes returned by server/api/*.ts - see server/schema.sql for the source of truth. */

export interface RemoteManualReport {
  id: string;
  createdAt: string;
  category: string;
  lat: number;
  lng: number;
  headingDeg: number | null;
  note: string | null;
  confidence: number;
  corroborationCount: number;
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
