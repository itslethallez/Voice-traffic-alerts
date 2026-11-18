jest.mock('../../lib/db', () => ({ sql: jest.fn().mockResolvedValue([]) }));

import {
  CORRIDOR_ALWAYS_NEARBY_M,
  CORRIDOR_HALF_ANGLE_DEG,
  FB_AGENT_PUBLISH_MIN_CONFIDENCE,
  selectCorridorAlerts,
} from '../postgis-helpers';
import { sql } from '../db';

const sqlMock = sql as unknown as jest.Mock;

/** Joins the tagged-template pieces so the emitted SQL can be asserted on
 * as plain text (parameter positions become `?`). */
function emittedSql(): { text: string; values: unknown[] } {
  const [strings, ...values] = sqlMock.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?'), values };
}

const BASE_PARAMS = {
  lat: -34.92,
  lng: 138.6,
  headingDeg: 90,
  radiusMeters: 5000,
  types: ['police', 'hazard'] as const,
};

describe('selectCorridorAlerts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enforces the fb_agent publication gate in SQL, regardless of requested types', async () => {
    await selectCorridorAlerts(BASE_PARAMS);
    const { text, values } = emittedSql();
    expect(text).toContain("a.source <> 'fb_agent'");
    expect(text).toContain('a.confidence >=');
    expect(values).toContain(FB_AGENT_PUBLISH_MIN_CONFIDENCE);
  });

  it('combines ST_DWithin with the bearing cone and the near-field override', async () => {
    await selectCorridorAlerts(BASE_PARAMS);
    const { text, values } = emittedSql();
    expect(text).toContain('ST_DWithin');
    expect(text).toContain('ST_Azimuth');
    expect(values).toContain(CORRIDOR_HALF_ANGLE_DEG);
    expect(values).toContain(CORRIDOR_ALWAYS_NEARBY_M);
  });

  it('emits a heading-nullable cone so a stationary driver gets a plain radius', async () => {
    await selectCorridorAlerts({ ...BASE_PARAMS, headingDeg: null });
    const { text } = emittedSql();
    expect(text).toContain('IS NULL');
  });

  it('short-circuits on an empty type list without hitting the database', async () => {
    const rows = await selectCorridorAlerts({ ...BASE_PARAMS, types: [] });
    expect(rows).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
