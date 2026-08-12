import type { WazeAlert } from '../../api/waze/types';
import { formatAnnouncement, formatDistance } from '../formatAnnouncement';
import type { AnnounceableAlert } from '../../engine/types';

function makeCandidate(
  overrides: Partial<AnnounceableAlert> & { type?: WazeAlert['type'] } = {}
): AnnounceableAlert {
  const alert: WazeAlert = {
    alert_id: 'wm-test',
    type: overrides.type ?? 'POLICE',
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
  return {
    alert,
    distanceMeters: overrides.distanceMeters ?? 800,
    bearingDeg: overrides.bearingDeg ?? 0,
    bearingDiffDeg: overrides.bearingDiffDeg ?? 0,
    ageMinutes: overrides.ageMinutes ?? 3,
  };
}

describe('formatDistance', () => {
  it('rounds to the nearest 100m under 1km', () => {
    expect(formatDistance(800)).toBe('800 metres');
    expect(formatDistance(749)).toBe('700 metres');
    expect(formatDistance(750)).toBe('800 metres');
  });

  it('rounds to the nearest 0.1km at or above 1km', () => {
    expect(formatDistance(1400)).toBe('1.4 kilometres');
    expect(formatDistance(1387)).toBe('1.4 kilometres');
  });

  it('uses the singular "kilometre" for exactly 1km', () => {
    expect(formatDistance(1000)).toBe('1 kilometre');
  });
});

describe('formatAnnouncement', () => {
  it('matches the spec example for a fresh police report', () => {
    const candidate = makeCandidate({ type: 'POLICE', distanceMeters: 800, ageMinutes: 3 });
    expect(formatAnnouncement(candidate)).toBe('Police reported, 800 metres ahead.');
  });

  it('matches the spec example for a fresh accident report, spoken as "Crash"', () => {
    const candidate = makeCandidate({ type: 'ACCIDENT', distanceMeters: 1400, ageMinutes: 3 });
    expect(formatAnnouncement(candidate)).toBe('Crash reported, 1.4 kilometres ahead.');
  });

  it('labels the other alert types', () => {
    expect(formatAnnouncement(makeCandidate({ type: 'HAZARD' }))).toContain('Hazard reported');
    expect(formatAnnouncement(makeCandidate({ type: 'ROAD_CLOSED' }))).toContain(
      'Road closed reported'
    );
    expect(formatAnnouncement(makeCandidate({ type: 'JAM' }))).toContain('Traffic jam reported');
  });

  it('does not append an age note at exactly 10 minutes old (exclusive boundary)', () => {
    const candidate = makeCandidate({ ageMinutes: 10 });
    expect(formatAnnouncement(candidate)).toBe('Police reported, 800 metres ahead.');
  });

  it('appends the age note just past 10 minutes old', () => {
    const candidate = makeCandidate({ ageMinutes: 12 });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported, 800 metres ahead. Reported 12 minutes ago.'
    );
  });

  it('rounds the appended age to the nearest whole minute', () => {
    const candidate = makeCandidate({ ageMinutes: 10.6 });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported, 800 metres ahead. Reported 11 minutes ago.'
    );
  });
});
