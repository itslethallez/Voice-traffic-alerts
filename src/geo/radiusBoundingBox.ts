import type { GeoPoint } from './types';
import { destinationPoint } from './destination';
import { formatCorner } from './format';
import type { WazeBoundingBoxParams } from './boundingBox';

/**
 * Axis-aligned bounding box covering a `radiusM` circle centred on
 * `position` - used for the "treat the driver as stationary" case, where
 * there's no heading to build a directional box from.
 */
export function radiusBoundingBox(position: GeoPoint, radiusM: number): WazeBoundingBoxParams {
  const north = destinationPoint(position, radiusM, 0);
  const south = destinationPoint(position, radiusM, 180);
  const east = destinationPoint(position, radiusM, 90);
  const west = destinationPoint(position, radiusM, 270);

  return {
    bottom_left: formatCorner({ latitude: south.latitude, longitude: west.longitude }),
    top_right: formatCorner({ latitude: north.latitude, longitude: east.longitude }),
  };
}
