import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Drive report UI contract', () => {
  it('opens on the Stage 8 status pill (mockup board 1), not a logo header', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const pill = source('src/screens/cruise/CruiseStatusPill.tsx');

    expect(drive).toContain('<CruiseStatusPill');
    expect(drive).not.toContain('shotgun-header.png');
    expect(pill).toContain('Watching');
    // Degraded feed is said in words, not only a dot colour.
    expect(pill).toContain('Offline - alerts may be out of date');
    expect(pill).toContain('Alerts not updating');
  });

  it('builds the screen chrome from the design-system base components only', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    for (const component of ['ScreenContainer', 'MapOverlayPanel', 'BottomSheet', 'AlertPill', 'Card']) {
      expect(drive).toContain(`<${component}`);
    }
    // No legacy palette or typography imports, no hardcoded hex colours,
    // and no absolute positioning (MapOverlayPanel/BottomSheet own that).
    expect(drive).not.toContain("../theme/colors");
    expect(drive).not.toContain('../theme/typography');
    expect(drive).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(drive).not.toContain("position: 'absolute'");
  });

  it('automatically dismisses each live alert card after 20 seconds', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;');
    expect(drive).toContain('setTimeout(() => {');
    expect(drive).toContain('setDismissedAnnouncementKey(latestAnnouncementKey);');
    expect(drive).toContain('}, ANNOUNCEMENT_CARD_TIMEOUT_MS);');
    expect(drive).toContain('clearTimeout(timeout);');
  });

  it('shows the live alert card (mockup board 2) in the top overlay panel, never a marquee', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const card = source('src/screens/cruise/LiveAlertCard.tsx');

    expect(drive).toContain('<LiveAlertCard');
    expect(drive).not.toContain('ReportTicker');
    expect(card).toContain('Show on map');
    expect(card).toContain('Dismiss');
    // "Still there" only where the backend can confirm it - no dead buttons.
    expect(card).toContain('{canConfirm ? (');
    expect(card).not.toMatch(/['">]Not there['"<]/);
  });

  it('drives the category filter row from the persisted filter-pill set', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const defaults = source('src/store/settingsDefaults.ts');

    expect(drive).toContain('ALERT_FILTER_CATEGORIES');
    expect(drive).toContain('toggleAlertTypeFilter');
    expect(drive).toContain('alertTypeFilters');
    for (const category of [
      'police',
      'mobile_camera',
      'fixed_camera',
      'traffic',
      'accident',
      'closure',
      'roadkill',
      'hazard',
    ]) {
      expect(defaults).toContain(`'${category}'`);
    }
  });

  it('renders "Ahead of you" in the BottomSheet with AheadRow rows', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<BottomSheet');
    expect(drive).toContain('Ahead of you');
    expect(drive).toContain('<FlatList');
    expect(drive).toContain('<AheadRow');
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

  it('matches the mockups: Report is a small bottom-right FAB, speed a left-edge paired sign', () => {
    // Cruising mockup (Im140.png): Report is a small circular FAB at the
    // map's bottom-right with a filled send-cursor icon, not a big dial;
    // the bottom row holds nothing else. Navigate's camera-icon pill is a
    // different treatment and deliberately not used here.
    const drive = source('src/screens/DriveScreen.tsx');
    const reportBar = source('src/screens/radar/ReportBar.tsx');
    const speedometer = source('src/screens/radar/Speedometer.tsx');

    expect(drive).not.toContain('<Speedometer');
    expect(drive).not.toContain('utilityButton');
    expect(reportBar).toContain('const REPORT_DIAL_SIZE = 64;');
    expect(reportBar).toContain('Navigation2');
    expect(reportBar).not.toContain('REPORT</Text>');

    // Stage 8 roundel: current speed with "km/h · limit" beneath - the
    // limit shows only when actually resolved (no fabricated limit).
    expect(speedometer).toContain('sizes.roundel');
    expect(speedometer).toContain('speedLimitKmh !== null');
    expect(speedometer).toContain('getCachedSpeedLimit');
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

  it('keeps the map controls at least 44dp tall', () => {
    const nativeMap = source('src/screens/radar/RadarMap.tsx');
    const webMap = source('src/screens/radar/RadarMap.web.tsx');

    for (const map of [nativeMap, webMap]) {
      expect(map).toMatch(/recenterButton:\s*\{[\s\S]*?width: 44,\s*height: 44,/);
      expect(map).toMatch(/zoomButton:\s*\{[\s\S]*?width: 44,\s*height: 44,/);
    }
  });
});
