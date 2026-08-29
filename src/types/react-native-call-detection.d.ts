/**
 * react-native-call-detection ships no TypeScript types of its own (plain
 * JS, no @types package). Only the surface actually used by
 * speech/callState.ts - matches index.js's real runtime signature: Android
 * emits "Offhook"/"Incoming"/"Disconnected"/"Missed"; iOS (CallKit-backed)
 * emits "Dialing"/"Incoming"/"Connected"/"Disconnected".
 */
declare module 'react-native-call-detection' {
  export type CallDetectionEvent = 'Offhook' | 'Incoming' | 'Disconnected' | 'Missed' | 'Dialing' | 'Connected';

  export default class CallDetectorManager {
    constructor(
      callback: (event: CallDetectionEvent, phoneNumber: string | null) => void,
      readPhoneNumberAndroid?: boolean,
      permissionDeniedCallback?: (result: string) => void,
      permissionMessage?: { title: string; message: string }
    );
    dispose(): void;
  }
}
