import { FIXED_SPEED_CAMERAS } from '../fixedSpeedCameras';

/* eslint-disable @typescript-eslint/no-require-imports -- plain JSON
   maintained by scripts/buildFixedCameraPlacements.js; no resolveJsonModule. */
const placements: {
  sites: Record<string, { address: string; latitude: number; longitude: number }>;
} = require('../../../scripts/data/sapol-camera-placements.json');

/**
 * The bundled offline fallback must be exactly the checked placements
 * (regenerate both with `node scripts/buildFixedCameraDataset.js
 * --dry-run --write-fallback`) - this is what stopped the old fallback
 * carrying a Woolpunda-Kanni pin ~230 km away at Port Augusta.
 */
describe('FIXED_SPEED_CAMERAS fallback', () => {
  it('matches the OSM placement table, site for site', () => {
    for (const camera of FIXED_SPEED_CAMERAS) {
      const code = camera.id.replace(/^sapol-/, '');
      const site = placements.sites[code];
      expect(site).toBeDefined();
      expect(camera.label).toBe(site.address);
      expect(camera.position).toEqual({ latitude: site.latitude, longitude: site.longitude });
    }
  });

  it('puts Woolpunda-Kanni on the Sturt Highway near Waikerie, not Port Augusta', () => {
    const camera = FIXED_SPEED_CAMERAS.find((c) => c.id === 'sapol-629');
    expect(camera?.position.longitude).toBeGreaterThan(139.9);
    expect(camera?.position.longitude).toBeLessThan(140.3);
  });
});
