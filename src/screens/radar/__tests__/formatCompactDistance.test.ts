import { formatCompactDistance } from '../formatCompactDistance';

describe('formatCompactDistance', () => {
  it('shows one decimal of kilometres under 10km', () => {
    expect(formatCompactDistance(700)).toBe('0.7km');
    expect(formatCompactDistance(1400)).toBe('1.4km');
    expect(formatCompactDistance(9949)).toBe('9.9km');
  });

  it('rounds to whole kilometres at or above 10km', () => {
    expect(formatCompactDistance(10000)).toBe('10km');
    expect(formatCompactDistance(12400)).toBe('12km');
    expect(formatCompactDistance(12600)).toBe('13km');
  });

  it('handles distances under a kilometre', () => {
    expect(formatCompactDistance(50)).toBe('0.1km');
    expect(formatCompactDistance(0)).toBe('0.0km');
  });
});
