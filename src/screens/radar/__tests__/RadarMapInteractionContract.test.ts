import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(root, 'src/screens/radar/RadarMap.tsx'), 'utf8');
const webSource = fs.readFileSync(path.join(root, 'src/screens/radar/RadarMap.web.tsx'), 'utf8');

describe('RadarMap interaction and marker contract', () => {
  it('puts visible words and accessible names on both circular zoom controls', () => {
    expect(source).toContain('accessibilityLabel="ZOOM IN"');
    expect(source).toContain('accessibilityLabel="ZOOM OUT"');
    expect(source).toMatch(/zoomButtonLabel}>IN<\/Text>/);
    expect(source).toMatch(/zoomButtonLabel}>OUT<\/Text>/);
  });

  it('renders and visibly selects a SHOW ON MAP target even when it is outside the current marker set', () => {
    expect(source).toContain('const mapRenderableAlerts =');
    expect(source).toContain('mapRenderableAlerts.map((alert)');
    expect(source).toContain('setSelectedAlert(focusedAlert);');
    expect(source).toContain('accessibilityState={{ selected: isSelected }}');
    expect(source).toContain('isSelected && styles.selectedMarker');
  });

  it('fits the driver and focused target before zooming into the target', () => {
    const fitIndex = source.indexOf('cameraRef.current.fitBounds(');
    const zoomIndex = source.indexOf('cameraRef.current?.setCamera({', fitIndex);

    expect(fitIndex).toBeGreaterThan(-1);
    expect(zoomIndex).toBeGreaterThan(fitIndex);
    expect(source).toContain('setTimeout(() => {');
  });

  it('clears report details when the map presentation changes', () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*setSelectedAlert\(null\);\s*setSettledFocusKey\(null\);\s*\}, \[mapPresentation\]\);/
    );
  });

  it('keeps the web adapter aligned for focus sequencing, labels, and flat range mode', () => {
    expect(webSource).toContain('const mapRenderableAlerts =');
    expect(webSource).toContain('map.fitBounds(');
    expect(webSource.indexOf('map.fitBounds(')).toBeLessThan(webSource.indexOf('map.flyTo('));
    expect(webSource).toMatch(/zoomButtonLabel}>IN<\/Text>/);
    expect(webSource).toMatch(/zoomButtonLabel}>OUT<\/Text>/);
    expect(webSource).toContain("pitch: 50");
    expect(webSource).not.toContain("pitch: 0");
    expect(webSource).toContain("bearing: 0");
    expect(webSource).toContain('NOTIFICATION AREA');
    expect(webSource).not.toContain('styles.radarRange');
  });

  it('uses squared flashing-light marks for police and camera glyphs for fixed cameras', () => {
    expect(source).toMatch(/policeSquare:[\s\S]*?borderRadius: 4,/);
    expect(source).toContain('Camera as CameraIcon');
    expect(source).toContain('<CameraIcon size={20}');
    expect(source).toMatch(/cameraSquare:[\s\S]*?borderRadius: 4,/);
    expect(webSource).toContain('Fixed speed camera');
    expect(webSource).toContain('cameraLens');
  });
});
