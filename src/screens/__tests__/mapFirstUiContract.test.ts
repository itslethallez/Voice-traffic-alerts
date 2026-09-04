import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('simplified map-first UI contract', () => {
  it('exposes Map, Reports, and Settings as accessible primary tabs', () => {
    const nav = source('src/navigation/BottomNav.tsx');

    expect(nav).toContain("{ key: 'map', label: 'MAP' }");
    expect(nav).toContain("{ key: 'reports', label: 'REPORTS' }");
    expect(nav).toContain("{ key: 'settings', label: 'SETTINGS' }");
    expect(nav).toContain('accessibilityRole="tab"');
    expect(nav).toContain('accessibilityState={{ selected: isActive }}');
  });

  it('makes the live map the Drive screen and keeps direct reporting available', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<RadarMap');
    expect(drive).toContain('minimal');
    expect(drive).toContain('<ReportBar');
    expect(drive).toContain('LIVE REPORTS');
    expect(drive).not.toContain('<ScrollView');
    expect(drive).not.toContain('<Speedometer');
    expect(drive).toContain('latestAnnouncement');
    expect(drive).toContain('SHOW ON MAP');

    const map = source('src/screens/radar/RadarMap.tsx');
    expect(map).toContain('pitch={50}');
    expect(map).toContain('ZOOM IN');
    expect(map).toContain('ZOOM OUT');
    expect(map).toContain('SHOW WARN RANGE');
    expect(map).toContain('mapbox://styles/mapbox/navigation-night-v1');
    expect(map).toContain('borderRadius: ALERT_PIN_SIZE / 2');

    const webMap = source('src/screens/radar/RadarMap.web.tsx');
    expect(webMap).toContain('LIVE WEB MAP');
    expect(webMap).toContain('mapVisibleAlerts');
    expect(webMap).toContain('accessibilityLabel');
  });

  it('labels the second screen as a closest-first list of current reports', () => {
    const reports = source('src/screens/ReportsScreen.tsx');

    expect(reports).toContain('CURRENT REPORTS');
    expect(reports).toContain('CLOSEST FIRST');
    expect(reports).toContain('accessibilityRole="button"');
    expect(reports).toContain('sortCurrentReportsByDistance');
    expect(reports).toContain('<PoliceLightBar');

    const nativeMap = source('src/screens/radar/RadarMap.tsx');
    expect(nativeMap).toContain('selectedAlert');
    expect(nativeMap).toContain('REPORTED');
  });
});
