import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/colors';
import { fontFamily } from '../../theme/typography';

interface VoiceNoteRowProps {
  uri: string;
  durationMs: number;
}

/**
 * Playback control for a tap-and-talk manual report (Step 12 #26), shown
 * in History under the report's row. Each instance owns its own
 * useAudioPlayer(uri), the same hook form NearbyTransmissionCard's replay
 * button plumbing is built on (there via createAudioPlayer directly) - one
 * player per row keeps play state independent when more than one voice
 * note is in the list.
 */
export function VoiceNoteRow({ uri, durationMs }: VoiceNoteRowProps) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const handlePress = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // expo-audio leaves the player parked at the end once playback
    // finishes, rather than resetting position - play() from there is a
    // silent no-op, so a finished clip needs an explicit seek back to the
    // start before it can be replayed.
    if (status.duration > 0 && status.currentTime >= status.duration) {
      player.seekTo(0).then(() => player.play());
    } else {
      player.play();
    }
  };

  const durationSeconds = Math.round(durationMs / 1000);

  return (
    <Pressable
      onPress={handlePress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause voice report' : 'Play voice report'}
    >
      <Text style={styles.icon}>{status.playing ? '⏸' : '▶'}</Text>
      <Text style={styles.duration}>{durationSeconds}s voice report</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.reportDim,
  },
  icon: {
    marginRight: 8,
    fontSize: 13,
    color: colors.report,
  },
  duration: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.ink,
  },
});
