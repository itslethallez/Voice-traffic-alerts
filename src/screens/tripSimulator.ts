import { destinationPoint } from '../geo/destination';
import { MOCK_DRIVER } from '../api/waze/__mocks__/alerts.fixture';
import type { DriverState } from '../engine/types';

/**
 * Steps 6-7 build the screens against a simulated drive rather than real
 * GPS: real location (foreground watch + background task) is Step 8's
 * job, and the live Waze API is Step 9's. Until then, this advances a
 * simulated driver forward along its heading at a constant speed, past
 * the mock fixture's alerts (which are placed relative to MOCK_DRIVER),
 * so the full engine -> speech pipeline is exercisable and demoable now.
 */
export const SIMULATED_SPEED_KMH = 40;

export const initialSimulatedDriver: DriverState = {
  position: { latitude: MOCK_DRIVER.latitude, longitude: MOCK_DRIVER.longitude },
  headingDeg: MOCK_DRIVER.heading,
  speedKmh: SIMULATED_SPEED_KMH,
};

export function advanceSimulatedDriver(driver: DriverState, elapsedMs: number): DriverState {
  if (elapsedMs <= 0) return driver;

  const speedMetersPerSecond = (driver.speedKmh * 1000) / 3600;
  const distanceMeters = speedMetersPerSecond * (elapsedMs / 1000);

  return {
    ...driver,
    position: destinationPoint(driver.position, distanceMeters, driver.headingDeg),
  };
}
