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

interface ReportDialProps {
  /** False while the driver is on History/Settings. DriveScreen now stays
   * mounted (display: none) rather than unmounting on a tab switch, so
   * this component's own unmount cleanup below no longer fires when the
   * driver leaves Drive - this prop is what actually detects that now. */
  isActive: boolean;
}

/**
 * "Report what you see" (Step 11b, tap-and-talk since Step 12 #26) - tap
 * once to start recording, tap again to stop and save. Local-only: there is
 * no Waze write API in this integration (see useTripStore's ManualReport
 * doc comment), so this can't submit anywhere - it just becomes a trip
 * record (with a playable voice note) visible in History, the same way a
 * spoken announcement does. Record-only, no transcription.
 */
export function ReportDial({ isActive }: ReportDialProps) {
  const pushManualReport = useTripStore((state) => state.pushManualReport);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [justReported, setJustReported] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live mirror of the isActive prop, read inside startRecording() after
  // its async permission/prepare gap - a plain closure over the prop
  // itself would only ever see whatever value was current when that
  // particular startRecording() call began, not whatever it is by the
  // time recording actually starts.
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

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

    if (!isActiveRef.current) {
      // The driver already left Drive while permission/prepare was still
      // in flight - the isActive effect already ran and bailed (isBusyRef
      // was still set for this very call), so recorder.record() above just
      // started a recording with nothing watching it. Finish it right now
      // instead of leaving it running until the 30s cap. Awaited (not
      // fire-and-forget) so isBusyRef - and the "is anything in flight"
      // guard other callers rely on - stays true until this is done.
      await finishRecording();
    }
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

  // Shared by both the isActive effect and the unmount cleanup below, so
  // "the driver left Drive" is handled identically regardless of which of
  // the two ways that can currently manifest.
  //
  // recorder.getStatus() (not recorderState, a stale closure from whichever
  // render created this callback) is checked live so a recording still in
  // progress gets stopped and saved instead of silently discarded, and the
  // audio session gets put back in ducking mode instead of stuck recording.
  //
  // Skipped while isBusyRef is set: that means startRecording() or
  // finishRecording() is already mid-flight (e.g. the driver tapped stop,
  // or the 30s cap fired, right as they navigated away) - those promises
  // keep running regardless (they're not tied to the component tree or to
  // isActive) and will save the report themselves once they settle, so
  // saving here too would create a duplicate entry.
  const stopAndSaveIfInProgress = useCallback(() => {
    const status = recorder.getStatus();
    if (!status.isRecording || isBusyRef.current) return;

    // Otherwise the 30s auto-stop timeout armed by startRecording is still
    // live and fires finishRecording() again later on an already-stopped
    // recorder - a second, duplicate manual report, and a confirmation
    // flash the driver never asked for whenever they come back to Drive.
    clearMaxDurationTimeout();

    const durationMs = status.durationMillis;
    recorder
      .stop()
      .then(() => configureDuckingAudioSession())
      .then(() => pushManualReport(recorder.uri ? { uri: recorder.uri, durationMs } : undefined))
      .catch(() => {});
  }, [clearMaxDurationTimeout, pushManualReport, recorder]);

  // DriveScreen now stays mounted (display: none) rather than unmounting
  // on a tab switch (see App.tsx), so this component's own unmount never
  // fires just from leaving Drive any more - isActive going false is the
  // actual "driver left Drive" signal now. The unmount cleanup below is
  // kept too, as a defence-in-depth backstop for the case DriveScreen ever
  // does unmount for a different reason.
  useEffect(() => {
    if (!isActive) stopAndSaveIfInProgress();
  }, [isActive, stopAndSaveIfInProgress]);

  useEffect(
    () => () => {
      clearMaxDurationTimeout();
      if (confirmationTimeoutRef.current !== null) clearTimeout(confirmationTimeoutRef.current);
      stopAndSaveIfInProgress();
    },
    [clearMaxDurationTimeout, stopAndSaveIfInProgress]
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
