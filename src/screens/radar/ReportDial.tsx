import { requestRecordingPermissionsAsync, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { configureDuckingAudioSession, configureRecordingAudioSession } from '../../speech/audioSession';
import { useTripStore } from '../../store/useTripStore';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

const MAX_RECORDING_SECONDS = 30;
const CONFIRMATION_DISPLAY_MS = 1500;
const DIAL_SIZE = 132;

const MIC_PERMISSION_DENIED_MESSAGE =
  'SHOTGUN needs microphone access to record voice reports. Enable it in Settings.';

/**
 * "Report what you see" (Step 11b, tap-and-talk since Step 12 #26) - tap
 * once to start recording, tap again to stop and save. Local-only: there is
 * no Waze write API in this integration (see useTripStore's ManualReport
 * doc comment), so this can't submit anywhere - it just becomes a trip
 * record (with a playable voice note) visible in History, the same way a
 * spoken announcement does. Record-only, no transcription.
 */
export function ReportDial() {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [justReported, setJustReported] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMaxDurationTimeout = useCallback(() => {
    if (maxDurationTimeoutRef.current !== null) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
  }, []);

  const finishRecording = useCallback(async () => {
    clearMaxDurationTimeout();
    // Not recorderState.durationMillis - that's a snapshot from whichever
    // render last ran when this closure was created, and the 30s
    // auto-stop timeout below schedules this callback once, at recording
    // start (duration ~0), then never gets a fresher one. recorder.getStatus()
    // reads the native recorder's live state at call time regardless of
    // which stale closure invokes it.
    const durationMs = recorder.getStatus().durationMillis;
    await recorder.stop();
    await configureDuckingAudioSession();

    pushManualReport(recorder.uri ? { uri: recorder.uri, durationMs } : undefined);

    setJustReported(true);
    if (confirmationTimeoutRef.current !== null) {
      clearTimeout(confirmationTimeoutRef.current);
    }
    confirmationTimeoutRef.current = setTimeout(() => {
      setJustReported(false);
      confirmationTimeoutRef.current = null;
    }, CONFIRMATION_DISPLAY_MS);
  }, [clearMaxDurationTimeout, pushManualReport, recorder]);

  const startRecording = useCallback(async () => {
    if (confirmationTimeoutRef.current !== null) {
      clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = null;
    }
    setJustReported(false);
    setPermissionError(null);

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionError(MIC_PERMISSION_DENIED_MESSAGE);
      return;
    }

    await configureRecordingAudioSession();
    await recorder.prepareToRecordAsync();
    recorder.record();
    maxDurationTimeoutRef.current = setTimeout(() => {
      void finishRecording();
    }, MAX_RECORDING_SECONDS * 1000);
  }, [finishRecording, recorder]);

  // Guards the async gap in both startRecording (permission request +
  // prepareToRecordAsync) and finishRecording (recorder.stop()) - without
  // it, a second tap landing before recorderState.isRecording has caught up
  // with reality can start a second overlapping recording, or run
  // finishRecording twice and push a duplicate manual report.
  const isBusyRef = useRef(false);

  const handlePress = useCallback(() => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    const pending = recorderState.isRecording ? finishRecording() : startRecording();
    pending.finally(() => {
      isBusyRef.current = false;
    });
  }, [finishRecording, recorderState.isRecording, startRecording]);

  useEffect(
    () => () => {
      clearMaxDurationTimeout();
      if (confirmationTimeoutRef.current !== null) clearTimeout(confirmationTimeoutRef.current);

      // Leaving Drive (e.g. to History/Settings) unmounts this component -
      // recorder.getStatus() (not recorderState, a stale closure from
      // mount time) is checked live so a recording still in progress gets
      // stopped and saved instead of silently discarded, and the audio
      // session gets put back in ducking mode instead of stuck recording.
      //
      // Skipped while isBusyRef is set: that means startRecording() or
      // finishRecording() is already mid-flight (e.g. the driver tapped
      // stop, or the 30s cap fired, right as they navigated away) - those
      // promises keep running after unmount regardless (they're not tied
      // to the component tree) and will save the report themselves once
      // they settle, so saving here too would create a duplicate entry.
      const status = recorder.getStatus();
      if (status.isRecording && !isBusyRef.current) {
        const durationMs = status.durationMillis;
        recorder
          .stop()
          .then(() => configureDuckingAudioSession())
          .then(() => pushManualReport(recorder.uri ? { uri: recorder.uri, durationMs } : undefined))
          .catch(() => {});
      }
    },
    [clearMaxDurationTimeout, pushManualReport, recorder]
  );

  const elapsedSeconds = Math.floor(recorderState.durationMillis / 1000);
  const subtitle = permissionError
    ? permissionError
    : justReported
      ? 'Reported - thanks'
      : recorderState.isRecording
        ? 'Tap again to finish'
        : 'Your location is added automatically';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>REPORT WHAT YOU SEE</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <Pressable
        onPress={handlePress}
        style={[styles.dial, recorderState.isRecording && styles.dialRecording]}
        accessibilityRole="button"
        accessibilityLabel={
          recorderState.isRecording ? 'Stop recording your voice report' : 'Start recording a voice report'
        }
      >
        <Text style={styles.dialCount}>{recorderState.isRecording ? elapsedSeconds : '🎙️'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 16,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  dial: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.report,
    borderWidth: 6,
    borderStyle: 'dotted',
    borderColor: colors.reportDim,
  },
  dialRecording: {
    borderColor: colors.report,
  },
  dialCount: {
    fontFamily: fontFamily.black,
    fontSize: 40,
    color: colors.background,
  },
});
