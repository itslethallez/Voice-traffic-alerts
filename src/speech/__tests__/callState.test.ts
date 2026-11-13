type CallCallback = (event: string, phoneNumber: string | null) => void;

const dispose = jest.fn();
let lastCallback: CallCallback | null = null;
const CallDetectorManagerCtor = jest.fn(
  (callback: CallCallback, _readPhoneNumberAndroid?: boolean, _permissionDeniedCallback?: () => void) => {
    lastCallback = callback;
    return { dispose };
  }
);

jest.mock('react-native-call-detection', () => ({
  __esModule: true,
  // jest.fn() returns a plain function, which - unlike an arrow function -
  // can be used as a constructor with `new`, matching how callState.ts
  // actually calls this (`new CallDetectorManager(...)`).
  default: CallDetectorManagerCtor,
}));

let platformOS: 'ios' | 'android' = 'ios';
const check = jest.fn();
const request = jest.fn();

jest.mock('react-native', () => ({
  get Platform() {
    return { OS: platformOS };
  },
  PermissionsAndroid: {
    PERMISSIONS: { READ_PHONE_STATE: 'android.permission.READ_PHONE_STATE' },
    RESULTS: { GRANTED: 'granted' },
    check: (...args: unknown[]) => check(...args),
    request: (...args: unknown[]) => request(...args),
  },
}));

import type {
  addCallStateListener as AddCallStateListener,
  isPhoneCallActive as IsPhoneCallActive,
  startCallStateMonitoring as StartCallStateMonitoring,
  stopCallStateMonitoring as StopCallStateMonitoring,
} from '../callState';

let addCallStateListener: typeof AddCallStateListener;
let isPhoneCallActive: typeof IsPhoneCallActive;
let startCallStateMonitoring: typeof StartCallStateMonitoring;
let stopCallStateMonitoring: typeof StopCallStateMonitoring;

describe('callState', () => {
  // A fresh module instance per test - isCallActive/detector/listeners are
  // all module-level state with no reset hook of their own (mirrors
  // ttsAdapter.test.ts's beforeEach for the same reason).
  beforeEach(() => {
    dispose.mockClear();
    CallDetectorManagerCtor.mockClear();
    check.mockReset();
    request.mockReset();
    platformOS = 'ios';
    lastCallback = null;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ addCallStateListener, isPhoneCallActive, startCallStateMonitoring, stopCallStateMonitoring } =
      require('../callState'));
  });

  it('starts inactive', () => {
    expect(isPhoneCallActive()).toBe(false);
  });

  it('on iOS, starts monitoring without requesting any Android permission', async () => {
    await startCallStateMonitoring();

    expect(check).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(CallDetectorManagerCtor).toHaveBeenCalledTimes(1);
  });

  it('flips active on an active-call event and notifies listeners', async () => {
    await startCallStateMonitoring();
    const listener = jest.fn();
    addCallStateListener(listener);

    lastCallback?.('Connected', null);

    expect(isPhoneCallActive()).toBe(true);
    expect(listener).toHaveBeenCalledWith('active');
  });

  it('flips back to inactive on Disconnected', async () => {
    await startCallStateMonitoring();
    const listener = jest.fn();
    addCallStateListener(listener);

    lastCallback?.('Connected', null);
    listener.mockClear();
    lastCallback?.('Disconnected', null);

    expect(isPhoneCallActive()).toBe(false);
    expect(listener).toHaveBeenCalledWith('inactive');
  });

  it('does not notify listeners again for a repeated active event', async () => {
    await startCallStateMonitoring();
    const listener = jest.fn();
    addCallStateListener(listener);

    lastCallback?.('Incoming', null);
    lastCallback?.('Offhook', null);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops future notifications', async () => {
    await startCallStateMonitoring();
    const listener = jest.fn();
    const unsubscribe = addCallStateListener(listener);
    unsubscribe();

    lastCallback?.('Connected', null);

    expect(listener).not.toHaveBeenCalled();
  });

  it('on Android, requests READ_PHONE_STATE before starting the listener when not already granted', async () => {
    platformOS = 'android';
    check.mockResolvedValue(false);
    request.mockResolvedValue('granted');

    await startCallStateMonitoring();

    expect(check).toHaveBeenCalledWith('android.permission.READ_PHONE_STATE');
    expect(request).toHaveBeenCalled();
    expect(CallDetectorManagerCtor).toHaveBeenCalledTimes(1);
  });

  it('on Android, skips the request when the permission is already granted', async () => {
    platformOS = 'android';
    check.mockResolvedValue(true);

    await startCallStateMonitoring();

    expect(request).not.toHaveBeenCalled();
    expect(CallDetectorManagerCtor).toHaveBeenCalledTimes(1);
  });

  it('on Android, never starts the native listener when permission is denied', async () => {
    platformOS = 'android';
    check.mockResolvedValue(false);
    request.mockResolvedValue('denied');

    await startCallStateMonitoring();

    expect(CallDetectorManagerCtor).not.toHaveBeenCalled();
    expect(isPhoneCallActive()).toBe(false);
  });

  it('is idempotent - a second call while already monitoring does not construct a second detector', async () => {
    await startCallStateMonitoring();
    await startCallStateMonitoring();

    expect(CallDetectorManagerCtor).toHaveBeenCalledTimes(1);
  });

  it('stopCallStateMonitoring disposes the detector and resets to inactive', async () => {
    await startCallStateMonitoring();
    lastCallback?.('Connected', null);
    expect(isPhoneCallActive()).toBe(true);

    stopCallStateMonitoring();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(isPhoneCallActive()).toBe(false);
  });
});
