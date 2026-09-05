import type { WazeAlert } from '../../api/waze/types';
import { sortCurrentReportsByDistance } from '../currentReports';

const alert = (alert_id: string, latitude: number, longitude: number): WazeAlert => ({
  alert_id,
  type: 'HAZARD',
  subtype: null,
  reported_by: null,
  description: null,
  image: null,
  publish_datetime_utc: '2026-09-03T08:00:00.000Z',
  country: 'AU',
  city: 'Adelaide',
  street: null,
  latitude,
  longitude,
  num_thumbs_up: 0,
  alert_reliability: 5,
  alert_confidence: 3,
  near_by: null,
  comments: [],
  num_comments: 0,
});

describe('sortCurrentReportsByDistance', () => {
  it('returns every current report nearest to farthest without mutating the source', () => {
    const source = [
      alert('far', -34.96, 138.70),
      alert('nearest', -34.93, 138.601),
      alert('middle', -34.93, 138.63),
    ];

    const result = sortCurrentReportsByDistance(source, { latitude: -34.93, longitude: 138.60 });

    expect(result.map((item) => item.alert.alert_id)).toEqual(['nearest', 'middle', 'far']);
    expect(result).toHaveLength(source.length);
    expect(source.map((item) => item.alert_id)).toEqual(['far', 'nearest', 'middle']);
  });

  it('returns an empty list until the user location is available', () => {
    expect(sortCurrentReportsByDistance([alert('one', -34.93, 138.60)], null)).toEqual([]);
  });
});
