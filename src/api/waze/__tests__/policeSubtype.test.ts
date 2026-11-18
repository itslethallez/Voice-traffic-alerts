import { policeSubtypeLabel } from '../policeSubtype';

describe('policeSubtypeLabel', () => {
  it('humanizes a confirmed real subtype, "Police" first', () => {
    expect(policeSubtypeLabel('POLICE_VISIBLE')).toBe('Police Visible');
  });

  it('humanizes a multi-word subtype, "Police" first', () => {
    expect(policeSubtypeLabel('POLICE_HIDING_UNMANNED')).toBe('Police Hiding Unmanned');
  });

  it('returns null for null', () => {
    expect(policeSubtypeLabel(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(policeSubtypeLabel(undefined)).toBeNull();
  });

  it('returns null for the shared NO_SUBTYPE sentinel', () => {
    expect(policeSubtypeLabel('NO_SUBTYPE')).toBeNull();
  });

  it('returns null for a subtype from a different alert type', () => {
    expect(policeSubtypeLabel('ACCIDENT_MAJOR')).toBeNull();
  });
});
