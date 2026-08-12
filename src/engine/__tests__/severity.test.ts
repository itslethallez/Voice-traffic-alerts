import type { WazeAlert, WazeAlertType } from '../../api/waze/types';
import { sortBySeverity } from '../severity';
import type { AnnounceableAlert } from '../types';

function makeCandidate(id: string, type: WazeAlertType, distanceMeters: number): AnnounceableAlert {
  const alert: WazeAlert = {
    alert_id: id,
    type,
    subtype: null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: '2026-01-01T00:00:00.000Z',
    country: 'AU',
    city: 'Adelaide',
    street: 'North Terrace',
    latitude: -34.9,
    longitude: 138.6,
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: null,
    comments: [],
    num_comments: 0,
  };
  return { alert, distanceMeters, bearingDeg: 0, bearingDiffDeg: 0, ageMinutes: 0 };
}

describe('sortBySeverity', () => {
  it('orders accident, road closure, hazard, police, jam', () => {
    const candidates = [
      makeCandidate('jam', 'JAM', 500),
      makeCandidate('police', 'POLICE', 500),
      makeCandidate('hazard', 'HAZARD', 500),
      makeCandidate('road_closed', 'ROAD_CLOSED', 500),
      makeCandidate('accident', 'ACCIDENT', 500),
    ];

    const sorted = sortBySeverity(candidates).map((c) => c.alert.alert_id);
    expect(sorted).toEqual(['accident', 'road_closed', 'hazard', 'police', 'jam']);
  });

  it('breaks ties within the same severity by ascending distance', () => {
    const candidates = [
      makeCandidate('far', 'POLICE', 1800),
      makeCandidate('near', 'POLICE', 400),
      makeCandidate('mid', 'POLICE', 900),
    ];

    const sorted = sortBySeverity(candidates).map((c) => c.alert.alert_id);
    expect(sorted).toEqual(['near', 'mid', 'far']);
  });

  it('sorts an unrecognized type last rather than dropping it', () => {
    const candidates = [
      makeCandidate('unknown', 'SOME_NEW_TYPE', 500),
      makeCandidate('jam', 'JAM', 500),
    ];

    const sorted = sortBySeverity(candidates).map((c) => c.alert.alert_id);
    expect(sorted).toEqual(['jam', 'unknown']);
  });
});
