import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('simplified map-first UI contract', () => {
  it('keeps the map as the only primary surface, with settings behind the header gear', () => {
    // §8 hierarchy: the map owns the screen - no bottom tab bar, and
    // secondary surfaces (settings) stay hidden until requested via the
    // top-right gear on the map header.
    const app = source('App.tsx');

    expect(app).not.toContain('BottomNav');

    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('accessibilityLabel="Open settings"');
    expect(drive).toContain('onOpenSettings');
  });

  it('makes the live map the Drive screen and keeps direct reporting available', () => {
    const drive = source('src/screens/DriveScreen.tsx');

    expect(drive).toContain('<RadarMap');
    expect(drive).toContain('minimal');
    expect(drive).toContain('<ReportBar');
    expect(drive).toContain('alerts nearby');
    expect(drive).not.toContain('<ScrollView');
    expect(drive).toContain('latestAnnouncement');
    expect(drive).toContain('SHOW ON MAP');
    // RANGE and MUTE live in Settings, not on the map screen: the paired
    // speed sign renders inside the map adapters (left-edge capsule),
    // not as a bottom-row dial in DriveScreen.
    expect(drive).not.toContain('Toggle notification range');
    expect(drive).not.toContain('Mute audio');
    expect(drive).not.toContain('<Speedometer');

    const map = source('src/screens/radar/RadarMap.tsx');
    expect(map).toContain('NAVIGATING_PITCH = 62');
    expect(map).toContain('CRUISING_PITCH = 50');
    expect(map).toContain('pitch={isNavigating ? NAVIGATING_PITCH : CRUISING_PITCH}');
    expect(map).not.toContain('pitch={50}');
    expect(map).toContain('ZOOM IN');
    expect(map).toContain('ZOOM OUT');
    expect(map).toContain('RECENTER ON MY LOCATION');
    // The notification-range ring is driven by the persisted SHOW RANGE
    // ON MAP setting (Settings > RANGE), not a Drive-screen button token.
    expect(map).toContain('showRangeOnMap');
    expect(map).not.toContain('rangeToggleToken');
    expect(map).toContain('<Speedometer />');
    expect(map).not.toContain('mapModeControl');
    // Base map is the bundled "Shotgun Night" style (decluttered +
    // repaletted navigation-night-v1) unless a Studio URL overrides it.
    expect(map).toContain('styleJSON: MAP_STYLE_JSON');
    expect(map).toContain('styleURL: MAP_STYLE_URL');
    expect(map).toContain('borderRadius: ALERT_PIN_SIZE / 2');

    const webMap = source('src/screens/radar/RadarMap.web.tsx');
    expect(webMap).toContain('LIVE WEB MAP');
    expect(webMap).toContain('mapVisibleAlerts');
    expect(webMap).toContain('accessibilityLabel');
    expect(webMap).toContain('<Speedometer />');

    // The moved controls' new home: Settings carries both the mute toggle
    // (SPEAK THESE > MUTE EVERYTHING) and the range-ring switch (RANGE >
    // SHOW RANGE ON MAP), so removing the map buttons orphans nothing.
    const settings = source('src/screens/SettingsScreen.tsx');
    expect(settings).toContain('MUTE EVERYTHING');
    expect(settings).toContain('toggleMasterMute');
    expect(settings).toContain('SHOW RANGE ON MAP');
    expect(settings).toContain('toggleRangeOnMap');
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
