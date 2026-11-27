import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Navigate mode feature flag', () => {
  const originalFlag = process.env.EXPO_PUBLIC_ENABLE_NAVIGATE;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_ENABLE_NAVIGATE;
    else process.env.EXPO_PUBLIC_ENABLE_NAVIGATE = originalFlag;
    jest.resetModules();
  });

  it('is off unless explicitly enabled', () => {
    delete process.env.EXPO_PUBLIC_ENABLE_NAVIGATE;
    jest.isolateModules(() => {
      expect(require('../featureFlags').NAVIGATE_MODE_ENABLED).toBe(false);
    });
  });

  it('can be turned back on for a dev build', () => {
    process.env.EXPO_PUBLIC_ENABLE_NAVIGATE = '1';
    jest.isolateModules(() => {
      expect(require('../featureFlags').NAVIGATE_MODE_ENABLED).toBe(true);
    });
  });

  it('gates every Navigate entry point and nav-only surface on the flag', () => {
    const app = source('App.tsx');
    const drive = source('src/screens/DriveScreen.tsx');

    // No onOpenSearch -> ModeSwitch omits the Navigate segment entirely.
    expect(app).toContain('onOpenSearch={NAVIGATE_MODE_ENABLED ?');
    expect(app).toContain('NAVIGATE_MODE_ENABLED && showNavigationSearch');
    expect(drive).toContain("state.status !== 'idle') && NAVIGATE_MODE_ENABLED");
    expect(drive).toMatch(/isNavigating =\s*NAVIGATE_MODE_ENABLED &&/);
    expect(drive).toMatch(/NAVIGATE_MODE_ENABLED \? \(\s*<View onLayout[\s\S]*?<NavigationStatusBar/);
  });
});
