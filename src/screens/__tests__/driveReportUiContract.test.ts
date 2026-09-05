import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Drive report UI contract', () => {
  it('uses the real Shotgun wordmark logo asset in the header, not a plain text label', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain("require('../../assets/shotgun-header.png')");
    expect(drive).not.toContain('streetwise-header.png');
    expect(drive).not.toMatch(/>SHOTGUN<\/Text>/);
  });

  it('adapts the header and control row for landscape orientation', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain("import { useIsLandscape } from '../hooks/useIsLandscape';");
    expect(drive).toContain('const isLandscape = useIsLandscape();');
    expect(drive).toMatch(/style=\{\[styles\.topBar, isLandscape && styles\.topBarLandscape\]\}/);
    expect(drive).toMatch(/style=\{\[styles\.controlRow, isLandscape && styles\.controlRowLandscape, compactControls && styles\.controlRowCompact\]\}/);
  });

  it('automatically dismisses each announced-report ticker after 20 seconds', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;');
    expect(drive).toContain('setTimeout(() => {');
    expect(drive).toContain('setDismissedAnnouncementKey(latestAnnouncementKey);');
    expect(drive).toContain('}, ANNOUNCEMENT_CARD_TIMEOUT_MS);');
    expect(drive).toContain('clearTimeout(timeout);');
  });

  it('keeps a compact live-report ticker in a dedicated lane below the header', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<View pointerEvents="box-none" style={styles.mapChrome}>');
    expect(drive).toMatch(/mapChrome:\s*\{\s*flex: 1,\s*minHeight: 0,\s*justifyContent: 'space-between',/);
    expect(drive).toContain("backgroundColor: hud.ground");
    expect(drive).toContain('<ReportTicker');
    expect(drive).toContain('LIVE REPORT');
    expect(drive).toContain('TAP TO SHOW ON MAP');
    expect(drive).not.toContain('announcementCard');
  });

  it('provides a top map recenter control on native and web map adapters', () => {
    const nativeMap = source('src/screens/radar/RadarMap.tsx');
    const webMap = source('src/screens/radar/RadarMap.web.tsx');

    for (const map of [nativeMap, webMap]) {
      expect(map).toContain('RECENTER ON MY LOCATION');
      expect(map).toContain('Centers the map on your current location');
      expect(map).toContain('recenterButton');
      expect(map).toContain('disabled={!driverPosition}');
      expect(map).toMatch(/mapControls:\s*\{[\s\S]*?flexDirection: 'column',/);
    }
    expect(webMap).not.toContain('new mapboxgl.NavigationControl');
  });

  it('mirrors the REPORT dial and speedometer as same-size circular controls on opposite sides', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const reportBar = source('src/screens/radar/ReportBar.tsx');
    const speedometer = source('src/screens/radar/Speedometer.tsx');

    expect(drive).toContain("import { Speedometer } from './radar/Speedometer';");
    expect(drive).toMatch(/<ReportBar \/>[\s\S]*?Toggle notification range[\s\S]*?Mute audio[\s\S]*?<Speedometer \/>/);
    expect(drive).toContain('ScanLine');
    expect(drive).toContain('toggleMasterMute');

    expect(reportBar).toContain('const REPORT_DIAL_SIZE = 112;');
    expect(speedometer).toContain('const SPEED_DIAL_SIZE = 112;');
  });

  it('hides the four report categories behind a single expandable REPORT dial', () => {
    const reportBar = source('src/screens/radar/ReportBar.tsx');

    for (const category of ['POLICE', 'ACCIDENT', 'HAZARD', 'JAM']) {
      expect(reportBar).toContain(`category: '${category}'`);
      expect(reportBar).toContain(`label: '${category}'`);
    }
    expect(reportBar.match(/category: '(POLICE|ACCIDENT|HAZARD|JAM)'/g)).toHaveLength(4);
    expect(reportBar).toContain('pushManualReport(def.category, null);');
    expect(reportBar).toContain('const [expanded, setExpanded] = useState(false);');
    expect(reportBar).toMatch(/\{expanded \? \(\s*<View style=\{styles\.fanOut\}/);
  });

  it('gives the bottom tab bar the same dark chrome as the header', () => {
    const bottomNav = source('src/navigation/BottomNav.tsx');

    expect(bottomNav).toContain("import { hud } from '../theme/colors';");
    expect(bottomNav).toMatch(/root:\s*\{[\s\S]*?backgroundColor: hud\.ground,/);
    expect(bottomNav).not.toContain("backgroundColor: '#FFFFFF'");
  });

  it('keeps the ticker and map controls at least 44dp tall', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const nativeMap = source('src/screens/radar/RadarMap.tsx');
    const webMap = source('src/screens/radar/RadarMap.web.tsx');

    expect(drive).toMatch(/tickerBanner:\s*\{[\s\S]*?height: 48,/);
    for (const map of [nativeMap, webMap]) {
      expect(map).toMatch(/recenterButton:\s*\{[\s\S]*?width: 44,\s*height: 44,/);
      expect(map).toMatch(/zoomButton:\s*\{[\s\S]*?width: 44,\s*height: 44,/);
    }
  });
});
