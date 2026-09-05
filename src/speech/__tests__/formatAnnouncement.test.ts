const fetchSuburbForPoint = jest.fn<Promise<string | null>, unknown[]>();
jest.mock('../../api/mapbox/reverseGeocode', () => ({
  fetchSuburbForPoint: (...args: unknown[]) => fetchSuburbForPoint(...args),
}));
jest.mock('../../config/env', () => ({
  env: { mapboxAccessToken: 'test-token' },
}));

import type { WazeAlert } from '../../api/waze/types';
import { prefetchSuburb } from '../../geo/suburbLookup';
import {
  announcementLocation,
  formatAnnouncement,
  formatBriefingAlert,
  formatDistance,
  labelForType,
  NO_BRIEFING_ALERTS_MESSAGE,
} from '../formatAnnouncement';
import type { AnnounceableAlert } from '../../engine/types';

function makeCandidate(
  overrides: Partial<AnnounceableAlert> & {
    type?: WazeAlert['type'];
    subtype?: string | null;
    street?: string | null;
    city?: string | null;
    nearBy?: string | null;
    latitude?: number;
    longitude?: number;
  } = {}
): AnnounceableAlert {
  const alert: WazeAlert = {
    alert_id: 'wm-test',
    type: overrides.type ?? 'POLICE',
    subtype: overrides.subtype ?? null,
    reported_by: null,
    description: null,
    image: null,
    publish_datetime_utc: '2026-01-01T00:00:00.000Z',
    country: 'AU',
    city: overrides.city !== undefined ? (overrides.city ?? '') : 'Adelaide',
    street: overrides.street !== undefined ? overrides.street : 'North Terrace',
    latitude: overrides.latitude ?? -34.9,
    longitude: overrides.longitude ?? 138.6,
    num_thumbs_up: 0,
    alert_reliability: 0,
    alert_confidence: 0,
    near_by: overrides.nearBy !== undefined ? overrides.nearBy : null,
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

  it('speaks a subtype-specific label for a POLICE alert when Waze provides one', () => {
    const candidate = makeCandidate({
      type: 'POLICE',
      subtype: 'POLICE_VISIBLE',
      street: 'North Terrace',
      city: 'Adelaide',
      distanceMeters: 800,
      ageMinutes: 3,
      driverHeadingDeg: 0,
    });
    expect(formatAnnouncement(candidate)).toBe(
      'Police Visible reported on North Terrace, Adelaide, northbound, 800 metres ahead.'
    );
  });

  it('falls back to the generic "Police" label when subtype is null', () => {
    const candidate = makeCandidate({ type: 'POLICE', subtype: null });
    expect(formatAnnouncement(candidate)).toMatch(/^Police reported/);
  });

  it('falls back to the generic "Police" label when subtype is the shared NO_SUBTYPE sentinel', () => {
    const candidate = makeCandidate({ type: 'POLICE', subtype: 'NO_SUBTYPE' });
    expect(formatAnnouncement(candidate)).toMatch(/^Police reported/);
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

  it('expands a road-type abbreviation at the end of the street name', () => {
    expect(formatAnnouncement(makeCandidate({ street: 'Anzac Hwy', city: 'Adelaide' }))).toContain(
      'on Anzac Highway, Adelaide'
    );
    expect(formatAnnouncement(makeCandidate({ street: 'North Tce', city: 'Adelaide' }))).toContain(
      'on North Terrace, Adelaide'
    );
    expect(formatAnnouncement(makeCandidate({ street: 'Anzac Rd', city: 'Adelaide' }))).toContain(
      'on Anzac Road, Adelaide'
    );
  });

  it('expands a leading "St" to "Saint" rather than "Street"', () => {
    expect(formatAnnouncement(makeCandidate({ street: 'St Kilda Rd', city: 'Melbourne' }))).toContain(
      'on Saint Kilda Road, Melbourne'
    );
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

  it('falls back to "near {near_by}" alongside the street when there is no suburb', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: null, nearBy: 'the casino' });
    expect(formatAnnouncement(candidate)).toContain('on North Terrace, near the casino');
  });

  it('falls back to "near {near_by}" alone when there is neither street nor suburb', () => {
    const candidate = makeCandidate({ street: null, city: null, nearBy: 'the casino' });
    expect(formatAnnouncement(candidate)).toContain('near the casino');
  });

  it('prefers the suburb over near_by when both are present', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: 'Adelaide', nearBy: 'the casino' });
    expect(formatAnnouncement(candidate)).toContain('on North Terrace, Adelaide');
    expect(formatAnnouncement(candidate)).not.toContain('near the casino');
  });

  it('expands road-type abbreviations on each side of a slash-joined intersection street', () => {
    const candidate = makeCandidate({ street: 'Main Rd/Cross Rd', city: 'Adelaide' });
    expect(formatAnnouncement(candidate)).toContain('on Main Road/Cross Road, Adelaide');
  });
});

describe('formatBriefingAlert', () => {
  it('speaks a subtype-specific label for a POLICE alert when Waze provides one', () => {
    const candidate = makeCandidate({
      type: 'POLICE',
      subtype: 'POLICE_VISIBLE',
      street: 'Anzac Highway',
      city: 'Adelaide',
      ageMinutes: 5,
    });
    expect(formatBriefingAlert(candidate)).toBe('Police Visible reported on Anzac Highway, Adelaide, 5 minutes ago.');
  });

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

describe('labelForType', () => {
  it('labels each known type, and falls back to "Alert" for an unknown one', () => {
    expect(labelForType('POLICE')).toBe('Police');
    expect(labelForType('ACCIDENT')).toBe('Crash');
    expect(labelForType('HAZARD')).toBe('Hazard');
    expect(labelForType('ROAD_CLOSED')).toBe('Road closed');
    expect(labelForType('JAM')).toBe('Traffic jam');
    expect(labelForType('SOMETHING_UNKNOWN')).toBe('Alert');
  });
});

describe('announcementLocation', () => {
  it('returns the street, area and quantized direction for an ordinary street', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: 'Adelaide', driverHeadingDeg: 0 });
    expect(announcementLocation(candidate)).toEqual({
      street: 'North Terrace',
      area: 'Adelaide',
      direction: 'north',
    });
  });

  it('never returns a bare route number as the street - matches formatAnnouncement', () => {
    const candidate = makeCandidate({ street: 'US-101 N', city: 'Oakland', driverHeadingDeg: 90 });
    expect(announcementLocation(candidate)).toEqual({
      street: null,
      area: 'Oakland',
      direction: 'east',
    });
  });

  it('returns null area when there is none, independent of the street', () => {
    const candidate = makeCandidate({ street: 'North Terrace', city: null, driverHeadingDeg: 180 });
    expect(announcementLocation(candidate)).toEqual({
      street: 'North Terrace',
      area: null,
      direction: 'south',
    });
  });

  it('expands road-type abbreviations, matching formatAnnouncement', () => {
    const candidate = makeCandidate({ street: 'Anzac Hwy', city: 'Adelaide', driverHeadingDeg: 0 });
    expect(announcementLocation(candidate).street).toBe('Anzac Highway');
  });
});

describe('suburb resolution (geo/suburbLookup)', () => {
  beforeEach(() => {
    fetchSuburbForPoint.mockReset();
  });

  it('prefers a resolved suburb over the raw Waze city, once prefetched', async () => {
    fetchSuburbForPoint.mockResolvedValue('Modbury North');
    const point = { latitude: -34.818022, longitude: 138.681585 };
    await prefetchSuburb(point);

    const candidate = makeCandidate({
      street: 'Milne Rd',
      city: 'Adelaide',
      latitude: point.latitude,
      longitude: point.longitude,
    });
    expect(formatAnnouncement(candidate)).toContain('on Milne Road, Modbury North');
    expect(announcementLocation(candidate).area).toBe('Modbury North');
  });

  it('falls back to the raw city when the suburb lookup resolved to nothing', async () => {
    fetchSuburbForPoint.mockResolvedValue(null);
    const point = { latitude: -34.7, longitude: 138.5 };
    await prefetchSuburb(point);

    const candidate = makeCandidate({
      street: 'Some Rd',
      city: 'Gawler',
      latitude: point.latitude,
      longitude: point.longitude,
    });
    expect(formatAnnouncement(candidate)).toContain('on Some Road, Gawler');
  });

  it('falls back to the raw city when no prefetch was ever attempted for that point', () => {
    const point = { latitude: -34.6, longitude: 138.4 };
    const candidate = makeCandidate({
      street: 'Untouched Rd',
      city: 'Somewhere',
      latitude: point.latitude,
      longitude: point.longitude,
    });
    expect(formatAnnouncement(candidate)).toContain('on Untouched Road, Somewhere');
    expect(fetchSuburbForPoint).not.toHaveBeenCalled();
  });
});
