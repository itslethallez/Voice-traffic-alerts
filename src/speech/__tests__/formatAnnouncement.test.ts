import type { WazeAlert } from '../../api/waze/types';
import { formatAnnouncement, formatBriefingAlert, formatDistance, NO_BRIEFING_ALERTS_MESSAGE } from '../formatAnnouncement';
import type { AnnounceableAlert } from '../../engine/types';

function makeCandidate(
  overrides: Partial<AnnounceableAlert> & {
    type?: WazeAlert['type'];
    street?: string | null;
    city?: string | null;
  } = {}
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
    city: overrides.city !== undefined ? (overrides.city ?? '') : 'Adelaide',
    street: overrides.street !== undefined ? overrides.street : 'North Terrace',
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
    driverHeadingDeg: overrides.driverHeadingDeg ?? 0,
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
  it('speaks the street, suburb and direction of travel for a fresh police report', () => {
    const candidate = makeCandidate({
      type: 'POLICE',
      street: 'North Terrace',
      city: 'Adelaide',
      distanceMeters: 800,
      ageMinutes: 3,
      driverHeadingDeg: 0,
    });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported on North Terrace, Adelaide, northbound, 800 metres ahead.'
    );
  });

  it('labels an accident report as "Crash"', () => {
    const candidate = makeCandidate({
      type: 'ACCIDENT',
      street: 'North Terrace',
      city: 'Adelaide',
      distanceMeters: 1400,
      ageMinutes: 3,
      driverHeadingDeg: 0,
    });
    expect(formatAnnouncement(candidate)).toBe(
      'Crash reported on North Terrace, Adelaide, northbound, 1.4 kilometres ahead.'
    );
  });

  it('never speaks a bare route/highway number as the street', () => {
    const candidate = makeCandidate({ street: 'US-101 N', city: 'Oakland' });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported in Oakland, northbound, 800 metres ahead.'
    );
  });

  it('omits other route-number shapes too (interstate, state route, short code)', () => {
    for (const routeNumber of ['I-95', 'SR-408', 'A1', '101']) {
      const candidate = makeCandidate({ street: routeNumber, city: 'Oakland' });
      expect(formatAnnouncement(candidate)).not.toContain(routeNumber);
      expect(formatAnnouncement(candidate)).toContain('in Oakland');
    }
  });

  it('speaks an ordinary named street normally, even one that starts with a number', () => {
    const candidate = makeCandidate({ street: '5th Avenue', city: 'Oakland' });
    expect(formatAnnouncement(candidate)).toContain('on 5th Avenue, Oakland');
  });

  it('falls back to just the suburb when there is no usable street', () => {
    const candidate = makeCandidate({ street: null, city: 'Adelaide', driverHeadingDeg: 90 });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported in Adelaide, eastbound, 800 metres ahead.'
    );
  });

  it('falls back to the bare distance wording when there is neither street nor suburb', () => {
    const candidate = makeCandidate({ street: null, city: null, distanceMeters: 800 });
    expect(formatAnnouncement(candidate)).toBe('Police reported, 800 metres ahead.');
  });

  it('quantizes the driver heading to the nearest of 4 cardinal directions', () => {
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 0 }))).toContain('northbound');
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 90 }))).toContain('eastbound');
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 180 }))).toContain('southbound');
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 270 }))).toContain('westbound');
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 40 }))).toContain('northbound');
    expect(formatAnnouncement(makeCandidate({ driverHeadingDeg: 50 }))).toContain('eastbound');
  });

  it('does not append an age note at exactly 10 minutes old (exclusive boundary)', () => {
    const candidate = makeCandidate({ street: null, city: null, ageMinutes: 10 });
    expect(formatAnnouncement(candidate)).toBe('Police reported, 800 metres ahead.');
  });

  it('appends the age note just past 10 minutes old', () => {
    const candidate = makeCandidate({ street: null, city: null, ageMinutes: 12 });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported, 800 metres ahead. Reported 12 minutes ago.'
    );
  });

  it('rounds the appended age to the nearest whole minute', () => {
    const candidate = makeCandidate({ street: null, city: null, ageMinutes: 10.6 });
    expect(formatAnnouncement(candidate)).toBe(
      'Police reported, 800 metres ahead. Reported 11 minutes ago.'
    );
  });
});

describe('formatBriefingAlert', () => {
  it('uses the street and suburb when present, and never appends a direction', () => {
    const candidate = makeCandidate({
      type: 'POLICE',
      street: 'Anzac Highway',
      city: 'Adelaide',
      ageMinutes: 12,
    });
    expect(formatBriefingAlert(candidate)).toBe(
      'Police reported on Anzac Highway, Adelaide, 12 minutes ago.'
    );
  });

  it('never speaks a bare route number - falls back to the suburb', () => {
    const candidate = makeCandidate({ street: 'US-101 N', city: 'Oakland', ageMinutes: 12 });
    expect(formatBriefingAlert(candidate)).toBe('Police reported in Oakland, 12 minutes ago.');
  });

  it('falls back to distance when there is neither street nor suburb', () => {
    const candidate = makeCandidate({
      street: null,
      city: null,
      distanceMeters: 1400,
      ageMinutes: 12,
    });
    expect(formatBriefingAlert(candidate)).toBe(
      'Police reported 1.4 kilometres away, 12 minutes ago.'
    );
  });

  it('falls back to the suburb when the street is an empty string', () => {
    const candidate = makeCandidate({ street: '', city: 'Adelaide', ageMinutes: 3 });
    expect(formatBriefingAlert(candidate)).toBe('Police reported in Adelaide, 3 minutes ago.');
  });

  it('falls back to the suburb when the street is whitespace-only', () => {
    const candidate = makeCandidate({ street: '   ', city: 'Adelaide', ageMinutes: 3 });
    expect(formatBriefingAlert(candidate)).toBe('Police reported in Adelaide, 3 minutes ago.');
  });

  it('trims surrounding whitespace from a real street name', () => {
    const candidate = makeCandidate({ street: '  Anzac Highway  ', city: 'Adelaide', ageMinutes: 12 });
    expect(formatBriefingAlert(candidate)).toBe(
      'Police reported on Anzac Highway, Adelaide, 12 minutes ago.'
    );
  });

  it('always states the age, unlike formatAnnouncement, even under the staleness cutoff', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: 'Adelaide', ageMinutes: 3 });
    expect(formatBriefingAlert(candidate)).toBe(
      'Police reported on North Terrace, Adelaide, 3 minutes ago.'
    );
  });

  it('rounds age to the nearest whole minute, singular at 1', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: 'Adelaide', ageMinutes: 0.6 });
    expect(formatBriefingAlert(candidate)).toBe(
      'Police reported on North Terrace, Adelaide, 1 minute ago.'
    );
  });

  it('labels the other alert types', () => {
    expect(
      formatBriefingAlert(makeCandidate({ type: 'ACCIDENT', street: 'A St', city: 'Town' }))
    ).toContain('Crash reported on');
    expect(
      formatBriefingAlert(makeCandidate({ type: 'JAM', street: 'A St', city: 'Town' }))
    ).toContain('Traffic jam reported on');
  });
});

describe('NO_BRIEFING_ALERTS_MESSAGE', () => {
  it('is the exact spoken message for an empty briefing', () => {
    expect(NO_BRIEFING_ALERTS_MESSAGE).toBe('No recent alerts within your briefing area.');
  });
});
