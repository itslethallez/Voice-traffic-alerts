import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
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
 * the confusion in getting OTA updates (ElevenLabs key, distance default,
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
        <Text style={styles.label}>Running</Text>
        <Text style={styles.value}>
          {Updates.isEmbeddedLaunch ? 'Embedded build (no OTA update applied)' : 'OTA update'}
        </Text>
      </View>
      <View style={[styles.row, styles.rowDivider]}>
        <Text style={styles.label}>Update ID</Text>
        <Text style={styles.value}>{Updates.updateId ?? '—'}</Text>
      </View>
      <View style={[styles.row, styles.rowDivider]}>
        <Text style={styles.label}>Published</Text>
        <Text style={styles.value}>
          {Updates.createdAt ? Updates.createdAt.toLocaleString() : '—'}
        </Text>
      </View>
      <View style={[styles.row, styles.rowDivider]}>
        <Text style={styles.label}>Channel</Text>
        <Text style={styles.value}>{Updates.channel ?? '—'}</Text>
      </View>
      <View style={[styles.row, styles.rowDivider]}>
        <Text style={styles.label}>Runtime version</Text>
        <Text style={styles.value}>{Updates.runtimeVersion ?? '—'}</Text>
      </View>

      <View style={styles.actionRow}>
        {state === 'ready' ? (
          <Pressable
            onPress={handleApplyUpdate}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel="Restart to apply the downloaded update"
          >
            <Text style={styles.buttonText}>Restart to apply update</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleCheckForUpdate}
            disabled={state === 'checking' || state === 'downloading'}
            style={[styles.button, (state === 'checking' || state === 'downloading') && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
          >
            {state === 'checking' || state === 'downloading' ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.buttonText}>Check for updates</Text>
            )}
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
    backgroundColor: colors.backgroundAccent,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(245, 245, 247, 0.12)',
  },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    color: colors.inkMuted,
  },
  value: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  actionRow: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  button: {
    alignSelf: 'stretch',
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.background,
  },
  status: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: '#E85D5D',
    textAlign: 'center',
  },
});
