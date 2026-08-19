import type { WazeAlert, WazeAlertsResponse } from '../types';
import type { WazeBoundingBoxParams } from '../../../geo/boundingBox';

const fetchWazeAlerts = jest.fn<Promise<WazeAlertsResponse>, unknown[]>();

jest.mock('../client', () => ({
  fetchWazeAlerts: (...args: unknown[]) => fetchWazeAlerts(...args),
}));

import { fetchAlertsForBoundingBox } from '../fetchAlertsForBoundingBox';
import { splitBoundingBoxIntoQuadrants } from '../../../geo/quadrants';

function makeAlert(id: string): WazeAlert {
  return {
    alert_id: id,
    type: 'POLICE',
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
}

function makeResponse(alerts: WazeAlert[]): WazeAlertsResponse {
  return {
    status: 'OK',
    request_id: 'test',
    parameters: { bottom_left: '', top_right: '', max_alerts: 200, max_jams: 0 },
    data: { alerts, jams: [] },
  };
}

const BOX = { bottom_left: '-35.0,138.0', top_right: '-34.0,139.0' };

describe('fetchAlertsForBoundingBox', () => {
  beforeEach(() => {
    fetchWazeAlerts.mockReset();
  });

  it('makes a single call and returns the alerts when under the 200 cap', async () => {
    const alerts = [makeAlert('a'), makeAlert('b')];
    fetchWazeAlerts.mockResolvedValue(makeResponse(alerts));

    const result = await fetchAlertsForBoundingBox(BOX);

    expect(fetchWazeAlerts).toHaveBeenCalledTimes(1);
    expect(result).toEqual(alerts);
  });

  it('splits into four quadrants and merges when the response hits the 200 cap', async () => {
    const fullBoxAlerts = Array.from({ length: 200 }, (_, i) => makeAlert(`full-${i}`));
    const quadrants = splitBoundingBoxIntoQuadrants(BOX);
    const quadrantAlertsByBox = new Map(
      quadrants.map((quadrant, i) => [JSON.stringify(quadrant), makeAlert(`quadrant-${i}`)])
    );

    fetchWazeAlerts.mockImplementation(async (box: unknown) => {
      if (JSON.stringify(box) === JSON.stringify(BOX)) return makeResponse(fullBoxAlerts);
      const alert = quadrantAlertsByBox.get(JSON.stringify(box as WazeBoundingBoxParams));
      return makeResponse(alert ? [alert] : []);
    });

    const result = await fetchAlertsForBoundingBox(BOX);

    // 1 initial call + 4 quadrant calls
    expect(fetchWazeAlerts).toHaveBeenCalledTimes(5);
    const ids = result.map((a) => a.alert_id).sort();
    expect(ids).toEqual(
      [...fullBoxAlerts.map((a) => a.alert_id), ...[...quadrantAlertsByBox.values()].map((a) => a.alert_id)].sort()
    );
  });

  it('dedupes an alert returned by both the full-box call and a quadrant call', async () => {
    const shared = makeAlert('shared');
    const fullBoxAlerts = [shared, ...Array.from({ length: 199 }, (_, i) => makeAlert(`full-${i}`))];

    fetchWazeAlerts.mockImplementation(async (box: unknown) => {
      if (JSON.stringify(box) === JSON.stringify(BOX)) return makeResponse(fullBoxAlerts);
      return makeResponse([shared]);
    });

    const result = await fetchAlertsForBoundingBox(BOX);
    const sharedCount = result.filter((a) => a.alert_id === 'shared').length;
    expect(sharedCount).toBe(1);
  });

  it('still returns the full-box alerts and the quadrants that succeeded when one quadrant fails', async () => {
    const fullBoxAlerts = Array.from({ length: 200 }, (_, i) => makeAlert(`full-${i}`));
    const quadrants = splitBoundingBoxIntoQuadrants(BOX);
    const failingQuadrant = JSON.stringify(quadrants[0]);

    fetchWazeAlerts.mockImplementation(async (box: unknown) => {
      if (JSON.stringify(box) === JSON.stringify(BOX)) return makeResponse(fullBoxAlerts);
      if (JSON.stringify(box) === failingQuadrant) throw new Error('network down');
      return makeResponse([makeAlert(`ok-${JSON.stringify(box)}`)]);
    });

    const result = await fetchAlertsForBoundingBox(BOX);

    // The 200 from the full-box call must survive a quadrant failure, not be discarded.
    for (const alert of fullBoxAlerts) {
      expect(result.some((a) => a.alert_id === alert.alert_id)).toBe(true);
    }
    // The 3 quadrants that succeeded should also be present.
    expect(result.length).toBeGreaterThan(fullBoxAlerts.length);
  });

  it('does not reject just because a single quadrant call rejects', async () => {
    const fullBoxAlerts = Array.from({ length: 200 }, (_, i) => makeAlert(`full-${i}`));

    fetchWazeAlerts.mockImplementation(async (box: unknown) => {
      if (JSON.stringify(box) === JSON.stringify(BOX)) return makeResponse(fullBoxAlerts);
      throw new Error('every quadrant fails');
    });

    await expect(fetchAlertsForBoundingBox(BOX)).resolves.toEqual(fullBoxAlerts);
  });
});
