describe('Android Facebook notification intake entrypoint', () => {
  it('loads the optional Expo module and exposes it through the typed adapter', async () => {
    const nativeModule = {
      getNotificationAccessStatusAsync: jest.fn().mockResolvedValue('denied'),
      isNotificationAccessGrantedAsync: jest.fn().mockResolvedValue(false),
      openNotificationAccessSettingsAsync: jest.fn().mockResolvedValue(true),
      addListener: jest.fn(),
    };
    const requireOptionalNativeModule = jest.fn().mockReturnValue(nativeModule);
    jest.resetModules();
    jest.doMock('expo-modules-core', () => ({ requireOptionalNativeModule }));

    const { facebookNotificationIntake } = require('../facebookNotificationIntake.android');

    await expect(
      facebookNotificationIntake.getNotificationAccessStatus(),
    ).resolves.toBe('denied');
    expect(requireOptionalNativeModule).toHaveBeenCalledWith(
      'FacebookNotificationListener',
    );
  });
});
