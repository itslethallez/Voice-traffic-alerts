import { AlertTriangle, Camera, Car, Cctv, Construction, PawPrint, Shield, type LucideIcon } from 'lucide-react-native';
import type { WazeAlert } from '../../api/waze/types';
import type { AlertFilterCategory } from '../../store/settingsDefaults';
import { alpha, colors } from '../../theme/tokens';

/**
 * How one alert category looks in the Stage 8 Cruise UI - the "Ahead of
 * you" rows and the live alert card share it so a camera is the same
 * amber tile everywhere (mockup boards 1 and 2).
 */
export interface AlertVisual {
  Icon: LucideIcon;
  /** Fill for the big live-alert tile and the card's border/progress. */
  color: string;
  /** Glyph colour drawn on `color`. */
  onColor: string;
  /** Small row tile background on a dark surface. */
  tint: string;
  /** Live alert headline ("Speed camera ahead"). */
  headline: string;
}

const VISUALS: Record<AlertFilterCategory, AlertVisual> = {
  police: { Icon: Shield, color: colors.police, onColor: colors.onPolice, tint: colors.policeTint, headline: 'Police reported ahead' },
  mobile_camera: { Icon: Camera, color: colors.camera, onColor: colors.onCaution, tint: colors.cautionTint, headline: 'Mobile camera ahead' },
  fixed_camera: { Icon: Cctv, color: colors.camera, onColor: colors.onCaution, tint: colors.cautionTint, headline: 'Speed camera ahead' },
  traffic: { Icon: Car, color: colors.critical, onColor: colors.night, tint: alpha(colors.critical, 0.18), headline: 'Heavy traffic ahead' },
  accident: { Icon: AlertTriangle, color: colors.critical, onColor: colors.night, tint: alpha(colors.critical, 0.18), headline: 'Crash ahead' },
  closure: { Icon: Construction, color: colors.caution, onColor: colors.onCaution, tint: colors.cautionTint, headline: 'Road closed ahead' },
  roadkill: { Icon: PawPrint, color: colors.roadkill, onColor: colors.night, tint: alpha(colors.roadkill, 0.18), headline: 'Animal on the road ahead' },
  hazard: { Icon: AlertTriangle, color: colors.caution, onColor: colors.onCaution, tint: colors.cautionTint, headline: 'Hazard ahead' },
};

export function alertVisual(category: AlertFilterCategory): AlertVisual {
  return VISUALS[category];
}

/**
 * Where an alert came from, for the card's source chip - stated plainly so
 * the driver can weigh it (official schedule vs a crowd report). Never a
 * person's name: reported_by is ignored on purpose.
 */
export function alertSourceLabel(alert: WazeAlert, category: AlertFilterCategory): string {
  if (category === 'fixed_camera' || category === 'mobile_camera') return 'Official · police data';
  if (alert.alert_id.startsWith('corridor:')) {
    return alert.num_thumbs_up > 0 ? `Shotgun drivers · ${alert.num_thumbs_up} confirmed` : 'Shotgun drivers';
  }
  if (alert.provider) return `Official · ${alert.provider}`;
  return alert.num_thumbs_up > 0 ? `Waze · ${alert.num_thumbs_up} confirmed` : 'Waze';
}
