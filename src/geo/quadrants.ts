import type { WazeBoundingBoxParams } from './boundingBox';
import { formatCorner } from './format';
import type { GeoPoint } from './types';

function parseCorner(corner: string): GeoPoint {
  const [latitude, longitude] = corner.split(',').map(Number);
  return { latitude, longitude };
}

/**
 * Splits a bounding box into four quadrants (south-west, south-east,
 * north-west, north-east), each still in the "lat,lon" string format the
 * endpoint expects. Used when a query hits the API's 200-alert cap -
 * that's the signal an area has more alerts than a single call can
 * return, so it gets tiled into four smaller boxes and dedupe-merged
 * (see api/waze/fetchAlertsForBoundingBox.ts) rather than silently
 * losing whatever didn't fit.
 */
export function splitBoundingBoxIntoQuadrants(box: WazeBoundingBoxParams): WazeBoundingBoxParams[] {
  const bottomLeft = parseCorner(box.bottom_left);
  const topRight = parseCorner(box.top_right);
  const mid: GeoPoint = {
    latitude: (bottomLeft.latitude + topRight.latitude) / 2,
    longitude: (bottomLeft.longitude + topRight.longitude) / 2,
  };

  const southWest: GeoPoint = bottomLeft;
  const northEast: GeoPoint = topRight;
  const southEast: GeoPoint = { latitude: bottomLeft.latitude, longitude: topRight.longitude };
  const northWest: GeoPoint = { latitude: topRight.latitude, longitude: bottomLeft.longitude };

  return [
    { bottom_left: formatCorner(southWest), top_right: formatCorner(mid) },
    {
      bottom_left: formatCorner({ latitude: southWest.latitude, longitude: mid.longitude }),
      top_right: formatCorner({ latitude: mid.latitude, longitude: southEast.longitude }),
    },
    {
      bottom_left: formatCorner({ latitude: mid.latitude, longitude: southWest.longitude }),
      top_right: formatCorner({ latitude: northWest.latitude, longitude: mid.longitude }),
    },
    { bottom_left: formatCorner(mid), top_right: formatCorner(northEast) },
  ];
}
