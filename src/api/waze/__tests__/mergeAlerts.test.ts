import type { WazeAlert } from '../types';
import { mergeAlertsById } from '../mergeAlerts';

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

describe('mergeAlertsById', () => {
  it('concatenates alerts from multiple lists', () => {
    const merged = mergeAlertsById([[makeAlert('a')], [makeAlert('b')]]);
    expect(merged.map((a) => a.alert_id).sort()).toEqual(['a', 'b']);
  });

  it('dedupes an alert id that appears in more than one list', () => {
    const merged = mergeAlertsById([[makeAlert('a'), makeAlert('b')], [makeAlert('b'), makeAlert('c')]]);
    expect(merged.map((a) => a.alert_id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for no input lists', () => {
    expect(mergeAlertsById([])).toEqual([]);
  });
});
