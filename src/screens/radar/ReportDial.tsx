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
    const durationMs = recorderState.durationMillis;
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
  }, [clearMaxDurationTimeout, pushManualReport, recorder, recorderState.durationMillis]);

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

  const handlePress = useCallback(() => {
    if (recorderState.isRecording) {
      void finishRecording();
    } else {
      void startRecording();
    }
  }, [finishRecording, recorderState.isRecording, startRecording]);

  useEffect(
    () => () => {
      clearMaxDurationTimeout();
      if (confirmationTimeoutRef.current !== null) clearTimeout(confirmationTimeoutRef.current);
    },
    [clearMaxDurationTimeout]
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
