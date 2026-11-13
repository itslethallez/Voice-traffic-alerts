import { confidenceLabel } from '../confidence';

describe('confidenceLabel', () => {
  it('is "High confidence" at 7 and above', () => {
    expect(confidenceLabel(7)).toBe('High confidence');
    expect(confidenceLabel(10)).toBe('High confidence');
  });

  it('is "Medium confidence" from 4 up to (not including) 7', () => {
    expect(confidenceLabel(4)).toBe('Medium confidence');
    expect(confidenceLabel(6)).toBe('Medium confidence');
  });

  it('is "Low confidence" below 4', () => {
    expect(confidenceLabel(3)).toBe('Low confidence');
    expect(confidenceLabel(0)).toBe('Low confidence');
  });
});
