import { alertTypeMeta } from '../alertTypeMeta';

describe('alertTypeMeta', () => {
  it('uses the generic per-type label when no subtype is given', () => {
    expect(alertTypeMeta('POLICE').label).toBe('Police');
  });

  it('prefers a subtype-specific label for POLICE when one is recognized', () => {
    expect(alertTypeMeta('POLICE', 'POLICE_VISIBLE').label).toBe('Visible police');
  });

  it('falls back to the generic label when the POLICE subtype is null', () => {
    expect(alertTypeMeta('POLICE', null).label).toBe('Police');
  });

  it('never consults subtype for a non-POLICE type', () => {
    expect(alertTypeMeta('ACCIDENT', 'POLICE_VISIBLE').label).toBe('Crash');
  });

  it('keeps color/emoji/letter unchanged regardless of subtype', () => {
    const withSubtype = alertTypeMeta('POLICE', 'POLICE_VISIBLE');
    const without = alertTypeMeta('POLICE');
    expect(withSubtype.color).toBe(without.color);
    expect(withSubtype.emoji).toBe(without.emoji);
    expect(withSubtype.letter).toBe(without.letter);
  });
});
