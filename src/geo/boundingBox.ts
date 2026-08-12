import type { GeoPoint } from './types';
import { destinationPoint } from './destination';

export interface WazeBoundingBoxParams {
  bottom_left: string;
  top_right: string;
}

/**
 * "lat,lon" - the order confirmed against real sample requests/responses
 * from the alerts-and-jams endpoint (see README's "Waze API" section).
 * Getting this order backwards doesn't error, it just silently returns
 * an empty alerts array.
 */
function formatCorner(point: GeoPoint): string {
  return `${point.latitude},${point.longitude}`;
}

/**
 * Axis-aligned bounding box, in the exact "lat,lon" string format the
 * alerts-and-jams endpoint expects, that encloses a rectangle extending
 * `aheadM` ahead of `position` along `headingDeg` and `sideM` either side
 * of that direction of travel.
 *
 * Corners are placed with destinationPoint() (great-circle math) rather
 * than a fixed degree offset, because a fixed degree offset applied to
 * longitude ignores that a degree of longitude shrinks by cos(latitude)
 * away from the equator - at Adelaide's latitude (~-34.9) that is about a
 * 20% narrower box than intended.
 */
export function boundingBox(
  position: GeoPoint,
  headingDeg: number,
  aheadM: number,
  sideM: number
): WazeBoundingBoxParams {
  const farCenter = destinationPoint(position, aheadM, headingDeg);

  const corners: GeoPoint[] = [
    position,
    destinationPoint(position, sideM, headingDeg - 90),
    destinationPoint(position, sideM, headingDeg + 90),
    destinationPoint(farCenter, sideM, headingDeg - 90),
    destinationPoint(farCenter, sideM, headingDeg + 90),
  ];

  const latitudes = corners.map((c) => c.latitude);
  const longitudes = corners.map((c) => c.longitude);

  const bottomLeft: GeoPoint = {
    latitude: Math.min(...latitudes),
    longitude: Math.min(...longitudes),
  };
  const topRight: GeoPoint = {
    latitude: Math.max(...latitudes),
    longitude: Math.max(...longitudes),
  };

  return {
    bottom_left: formatCorner(bottomLeft),
    top_right: formatCorner(topRight),
  };
}
