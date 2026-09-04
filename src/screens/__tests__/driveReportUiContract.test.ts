import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Drive report UI contract', () => {
  it('uses the same compact brand icon and title hierarchy as the other primary screens', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain("require('../../assets/streetwise-icon.png')");
    expect(drive).toMatch(/<Text style=\{styles\.brandTitle\}[^>]*>STREETWISE<\/Text>/);
    expect(drive).toContain('<Text style={styles.brandSubtitle}>LIVE MAP</Text>');
    expect(drive).toMatch(/brandIcon:\s*\{\s*width: 42,\s*height: 42,/);
    expect(drive).not.toContain('streetwise-header.png');
  });

  it('automatically dismisses each announced-report card after 20 seconds', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('const ANNOUNCEMENT_CARD_TIMEOUT_MS = 20_000;');
    expect(drive).toContain('setTimeout(() => {');
    expect(drive).toContain('setDismissedAnnouncementKey(latestAnnouncementKey);');
    expect(drive).toContain('}, ANNOUNCEMENT_CARD_TIMEOUT_MS);');
    expect(drive).toContain('clearTimeout(timeout);');
  });

  it('keeps the announced-report card in a dedicated flex lane below the header', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<View pointerEvents="box-none" style={styles.mapChrome}>');
    expect(drive).toMatch(/mapChrome:\s*\{\s*flex: 1,\s*minHeight: 0,\s*justifyContent: 'flex-end',/);
    expect(drive).toMatch(/style=\{styles\.mapChrome\}>\s*<View style=\{styles\.bottomStack\}>\s*\{latestAnnouncement/);
  });

  it('retains the live speed readout in the floating map-first report dock', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain("import { Speedometer } from './radar/Speedometer';");
    expect(drive).toMatch(/<View style=\{styles\.reportDock\}>\s*<Speedometer \/>\s*<ReportBar \/>/);
  });

  it('offers one-tap police, accident, hazard, and jam report actions', () => {
    const reportBar = source('src/screens/radar/ReportBar.tsx');

    for (const category of ['POLICE', 'ACCIDENT', 'HAZARD', 'JAM']) {
      expect(reportBar).toContain(`category: '${category}'`);
      expect(reportBar).toContain(`label: '${category}'`);
    }
    expect(reportBar.match(/category: '(POLICE|ACCIDENT|HAZARD|JAM)'/g)).toHaveLength(4);
    expect(reportBar).toContain('pushManualReport(def.category, null);');
  });

  it('keeps all new and existing report controls at least 44dp tall', () => {
    const drive = source('src/screens/DriveScreen.tsx');
    const reportBar = source('src/screens/radar/ReportBar.tsx');

    expect(drive).toMatch(/showOnMapButton:\s*\{[\s\S]*?minHeight: 44,/);
    expect(drive).toMatch(/dismissButton:\s*\{[\s\S]*?minWidth: 44,\s*minHeight: 44,/);
    expect(reportBar).toMatch(/cell:\s*\{\s*flex: 1,\s*minHeight: 48,/);
  });
});
