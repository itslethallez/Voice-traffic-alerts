import { sortFacebookNotification } from '../sortFacebookNotification';

const event = (overrides: Partial<Parameters<typeof sortFacebookNotification>[0]> = {}) => ({
  packageName: 'com.facebook.katana' as const,
  notificationKey: 'facebook|42',
  postedAt: 1_700_000_000_000,
  title: 'Adelaide traffic update',
  text: 'Police speed camera on South Road near Goodwood heading north',
  ...overrides,
});

describe('sortFacebookNotification', () => {
  it('normalizes a specific incident into an eligible community candidate', () => {
    expect(sortFacebookNotification(event())).toEqual({
      source: 'facebook_notification',
      sourceRef: 'facebook|42',
      capturedAtMs: 1_700_000_000_000,
      category: 'POLICE',
      subtype: 'POLICE_VISIBLE',
      locationText: 'South Road',
      direction: 'NORTH',
      summary: 'POLICE · South Road · NORTH',
      confidence: 0.95,
      decision: 'eligible',
    });
  });

  it('keeps an incident with weak location evidence in review', () => {
    const candidate = sortFacebookNotification(
      event({ notificationKey: 'facebook|43', text: 'Crash reported near Anzac Hwy' }),
    );

    expect(candidate).toMatchObject({
      sourceRef: 'facebook|43',
      category: 'ACCIDENT',
      locationText: 'Anzac Hwy',
      decision: 'review',
    });
    expect(candidate?.confidence).toBeLessThan(0.8);
  });

  it('ignores notifications that do not describe a traffic incident', () => {
    expect(
      sortFacebookNotification(
        event({ title: 'Facebook', text: 'Happy birthday! See you tonight.' }),
      ),
    ).toBeNull();
  });

  it('rejects non-Facebook events and does not retain raw notification text', () => {
    const result = sortFacebookNotification(
      event({
        packageName: 'com.example.other' as 'com.facebook.katana',
        text: 'Police on South Road. Private person name and phone 0400000000',
      }),
    );

    expect(result).toBeNull();
  });

  it('handles truncated or missing notification fields safely', () => {
    expect(
      sortFacebookNotification(
        event({ notificationKey: '', title: null, text: 'debris on Port Road' }),
      ),
    ).toBeNull();
    expect(
      sortFacebookNotification(
        event({ notificationKey: 'facebook|44', title: null, text: null }),
      ),
    ).toBeNull();
  });
});
