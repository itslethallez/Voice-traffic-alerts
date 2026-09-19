import { corridorAlertToWazeAlert } from '../corridorAlert';
import type { RemoteCorridorAlert } from '../types';

const ROW: RemoteCorridorAlert = {
  id: 'b1b6d2f0-3c2e-4f5a-9c8d-0000000000aa',
  type: 'police',
  lat: -34.92,
  lng: 138.6,
  radius_m: 250,
  confidence: 80,
  source: 'crowd_api',
  first_seen: '2026-09-17T04:00:00Z',
  expires_at: '2026-09-17T05:00:00Z',
  corroboration_count: 3,
  distance_m: 1200,
  bearing_deg: 42,
};

describe('corridorAlertToWazeAlert', () => {
  it('namespaces the id and maps the normalized type to the feed equivalent', () => {
    const alert = corridorAlertToWazeAlert(ROW);
    expect(alert).not.toBeNull();
    expect(alert!.alert_id).toBe(`corridor:${ROW.id}`);
    expect(alert!.type).toBe('POLICE');
  });

  it('maps every normalized type, keeping the camera types distinct from POLICE', () => {
    const expected: Record<string, string> = {
      police: 'POLICE',
      mobile_camera: 'MOBILE_CAMERA',
      fixed_camera: 'FIXED_CAMERA',
      traffic: 'JAM',
      accident: 'ACCIDENT',
      closure: 'ROAD_CLOSED',
      roadkill: 'ROADKILL',
      hazard: 'HAZARD',
    };
    for (const [type, wazeType] of Object.entries(expected)) {
      expect(corridorAlertToWazeAlert({ ...ROW, type })!.type).toBe(wazeType);
    }
  });

  it('drops rows whose type is outside the normalized enum', () => {
    expect(corridorAlertToWazeAlert({ ...ROW, type: 'ufo' })).toBeNull();
  });

  it('carries first_seen as the published timestamp and corroboration as thumbs-up', () => {
    const alert = corridorAlertToWazeAlert(ROW)!;
    expect(alert.publish_datetime_utc).toBe(ROW.first_seen);
    expect(alert.num_thumbs_up).toBe(ROW.corroboration_count);
    expect(alert.latitude).toBe(ROW.lat);
    expect(alert.longitude).toBe(ROW.lng);
  });
});
