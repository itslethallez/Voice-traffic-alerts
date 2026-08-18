import { FirstFixGate, hasValidCoordinates, isAccurateEnough } from '../firstFixGate';

describe('hasValidCoordinates', () => {
  it('accepts ordinary finite coordinates', () => {
    expect(hasValidCoordinates({ latitude: -34.9, longitude: 138.6, accuracy: 10 })).toBe(true);
  });

  it('rejects NaN', () => {
    expect(hasValidCoordinates({ latitude: NaN, longitude: 138.6, accuracy: 10 })).toBe(false);
  });

  it('rejects out-of-range latitude/longitude', () => {
    expect(hasValidCoordinates({ latitude: 91, longitude: 0, accuracy: 10 })).toBe(false);
    expect(hasValidCoordinates({ latitude: 0, longitude: -181, accuracy: 10 })).toBe(false);
  });
});

describe('isAccurateEnough', () => {
  it('accepts when accuracy is unavailable', () => {
    expect(isAccurateEnough(null, 50)).toBe(true);
    expect(isAccurateEnough(undefined, 50)).toBe(true);
  });

  it('accepts at or under the threshold', () => {
    expect(isAccurateEnough(50, 50)).toBe(true);
    expect(isAccurateEnough(10, 50)).toBe(true);
  });

  it('rejects worse than the threshold', () => {
    expect(isAccurateEnough(51, 50)).toBe(false);
  });
});

describe('FirstFixGate', () => {
  const VALID_FIX = { latitude: -34.9, longitude: 138.6 };

  it('rejects invalid coordinates regardless of accuracy or wait budget', () => {
    const gate = new FirstFixGate(50, 5000);
    expect(gate.isUsable({ latitude: NaN, longitude: 0, accuracy: 5 }, 0)).toBe(false);
  });

  it('accepts an accurate fix immediately', () => {
    const gate = new FirstFixGate(50, 5000);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 10 }, 0)).toBe(true);
  });

  it('accepts immediately when accuracy is unreported', () => {
    const gate = new FirstFixGate(50, 5000);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: null }, 0)).toBe(true);
  });

  it('holds out on a poor-accuracy fix until the wait budget elapses', () => {
    const gate = new FirstFixGate(50, 5000);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 0)).toBe(false);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 4999)).toBe(false);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 5000)).toBe(true);
  });

  it('accepts a fix once the wait budget elapses even if still inaccurate', () => {
    const gate = new FirstFixGate(50, 5000);
    gate.isUsable({ ...VALID_FIX, accuracy: 500 }, 1000); // starts the deadline at 1000+5000=6000
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 500 }, 5999)).toBe(false);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 500 }, 6000)).toBe(true);
  });

  it('accepts immediately if a later fix happens to be accurate, without waiting out the budget', () => {
    const gate = new FirstFixGate(50, 5000);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 0)).toBe(false);
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 20 }, 1000)).toBe(true);
  });

  it('does not restart the wait deadline once one is already set', () => {
    const gate = new FirstFixGate(50, 5000);
    gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 0); // deadline set to 5000
    gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 2000); // should not push deadline to 7000
    expect(gate.isUsable({ ...VALID_FIX, accuracy: 200 }, 5000)).toBe(true);
  });
});
