import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('simplified map-first UI contract', () => {
  it('exposes Map and Settings as accessible primary tabs', () => {
    const nav = source('src/navigation/BottomNav.tsx');

    expect(nav).toContain("{ key: 'map', label: 'MAP' }");
    expect(nav).toContain("{ key: 'settings', label: 'SETTINGS' }");
    expect(nav).not.toContain("'reports'");
    expect(nav).toContain('accessibilityRole="tab"');
    expect(nav).toContain('accessibilityState={{ selected: isActive }}');
  });

  it('makes the live map the Drive screen and keeps direct reporting available', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<RadarMap');
    expect(drive).toContain('minimal');
    expect(drive).toContain('<ReportBar');
    expect(drive).toContain('alerts nearby');
    expect(drive).not.toContain('<ScrollView');
    expect(drive).toContain('<Speedometer');
    expect(drive).toContain('latestAnnouncement');
    expect(drive).toContain('SHOW ON MAP');
    expect(drive).toContain('Toggle notification range');
    expect(drive).toContain('Mute audio');

    const map = source('src/screens/radar/RadarMap.tsx');
    expect(map).toContain('pitch={50}');
    expect(map).not.toContain("pitch={mapPresentation === 'range' ? 0 : 50}");
    expect(map).toContain('ZOOM IN');
    expect(map).toContain('ZOOM OUT');
    expect(map).toContain('RECENTER ON MY LOCATION');
    expect(map).toContain('rangeToggleToken');
    expect(map).not.toContain('mapModeControl');
    expect(map).toContain('mapbox://styles/mapbox/navigation-night-v1');
    expect(map).toContain('borderRadius: ALERT_PIN_SIZE / 2');

    const webMap = source('src/screens/radar/RadarMap.web.tsx');
    expect(webMap).toContain('LIVE WEB MAP');
    expect(webMap).toContain('mapVisibleAlerts');
    expect(webMap).toContain('accessibilityLabel');
  });

  it('keeps the unverified community intake reviewable inside the Drive sheet', () => {
    // ReportsScreen was removed when its list/focus behavior folded into the
    // map sheet, but the Facebook-review queue is the one piece with no
    // other surface — it must stay reachable or unverified fb_agent notices
    // would have no human-in-the-loop checkpoint in the app.
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('COMMUNITY INTAKE');
    expect(drive).toContain('useCommunityReportStore');
    expect(drive).toContain('dismissCandidate');
    expect(drive).toContain('UNVERIFIED');

    const nativeMap = source('src/screens/radar/RadarMap.tsx');
    expect(nativeMap).toContain('selectedAlert');
    expect(nativeMap).toContain('REPORTED');
  });
});
