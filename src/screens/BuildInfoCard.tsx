import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { instrument } from '../theme/colors';
import { fontFamily } from '../theme/typography';

/**
 * expo-updates' native module has been a moving target this whole
 * project (added to the app config partway through this codebase's
 * history - see the "Add expo-updates" commit), so whichever binary is
 * actually installed at any given moment might predate it being linked.
 * A static `import * as Updates from 'expo-updates'` reads native-bridged
 * constants at module-evaluation time, so on a binary without the native
 * module, that throw would take down the whole Settings screen with it -
 * same risk RadarMap.tsx already guards against for @rnmapbox/maps.
 * Loading it lazily behind a try/catch keeps that throw local and
 * catchable instead.
 */
type UpdatesModule = typeof import('expo-updates');
let Updates: UpdatesModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Updates = require('expo-updates') as UpdatesModule;
} catch {
  Updates = null;
}

type CheckState = 'idle' | 'checking' | 'downloading' | 'upToDate' | 'ready' | 'error';

/**
 * Answers "what's actually running on this device right now" directly,
 * rather than inferring it from "did I relaunch enough times." Most of
 * the confusion in getting OTA updates (Google TTS key, distance default,
 * etc.) to actually show up traced back to not being able to tell,
 * on-device, whether a push had landed yet - this makes that observable,
 * and lets the driver force a check/apply instead of blindly relaunching.
 */
export function BuildInfoCard() {
  const [state, setState] = useState<CheckState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (!Updates) {
    return (
      <View style={styles.card}>
        <Text style={styles.status}>
          Build info unavailable - this binary doesn't have expo-updates linked. Rebuilding (not
          just an OTA push) should fix this.
        </Text>
      </View>
    );
  }

  const handleCheckForUpdate = async () => {
    if (!Updates.isEnabled) {
      setState('error');
      setMessage('Updates are disabled in this build (development/Expo Go).');
      return;
    }

    setState('checking');
    setMessage(null);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setState('upToDate');
        return;
      }

      setState('downloading');
      await Updates.fetchUpdateAsync();
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleApplyUpdate = async () => {
    try {
      await Updates.reloadAsync();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>RUNNING</Text>
        <Text style={styles.value}>
          {Updates.isEmbeddedLaunch ? 'Embedded build (no OTA update applied)' : 'OTA update'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>UPDATE ID</Text>
        <Text style={styles.value}>{Updates.updateId ?? '—'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>PUBLISHED</Text>
        <Text style={styles.value}>
          {Updates.createdAt ? Updates.createdAt.toLocaleString() : '—'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>CHANNEL</Text>
        <Text style={styles.value}>{Updates.channel ?? '—'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>RUNTIME VERSION</Text>
        <Text style={styles.value}>{Updates.runtimeVersion ?? '—'}</Text>
      </View>

      <View style={styles.actionRow}>
        {state === 'ready' ? (
          <Pressable
            onPress={handleApplyUpdate}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Restart to apply the downloaded update"
          >
            {({ pressed }) => (
              <Text style={[styles.buttonText, pressed && styles.buttonTextPressed]}>
                RESTART TO APPLY UPDATE
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={handleCheckForUpdate}
            disabled={state === 'checking' || state === 'downloading'}
            style={({ pressed }) => [
              styles.button,
              (state === 'checking' || state === 'downloading') && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
          >
            {({ pressed }) =>
              state === 'checking' || state === 'downloading' ? (
                <ActivityIndicator color={instrument.ink} />
              ) : (
                <Text style={[styles.buttonText, pressed && styles.buttonTextPressed]}>
                  CHECK FOR UPDATES
                </Text>
              )
            }
          </Pressable>
        )}

        {state === 'checking' ? <Text style={styles.status}>Checking…</Text> : null}
        {state === 'downloading' ? <Text style={styles.status}>Downloading…</Text> : null}
        {state === 'upToDate' ? <Text style={styles.status}>You're up to date.</Text> : null}
        {state === 'ready' ? (
          <Text style={styles.status}>Update downloaded - restart to apply it.</Text>
        ) : null}
        {state === 'error' && message ? <Text style={styles.errorText}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: instrument.ruleOnInk,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: instrument.mutedOnInk,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    color: instrument.paper,
    flexShrink: 1,
    textAlign: 'right',
  },
  actionRow: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 8,
  },
  button: {
    height: 44,
    backgroundColor: instrument.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: instrument.ink,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    letterSpacing: 1,
    color: instrument.ink,
  },
  buttonTextPressed: {
    color: instrument.paper,
  },
  status: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: instrument.mutedOnInk,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: '#E85D5D',
    textAlign: 'center',
  },
});
