import { colors } from '../../theme/tokens';

/**
 * §7's Navigate vehicle marker: a top-down car silhouette inside an
 * accent halo, replacing the plain white triangle. Shared verbatim
 * between the native MarkerView (rendered through react-native-svg's
 * SvgXml) and the web adapter's DOM marker so both platforms draw the
 * identical glyph. The camera is heading-up while driving, so "up" on
 * the glyph is the direction of travel - same contract the old
 * triangle documented.
 */
export const DRIVER_CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><circle cx="15" cy="20" r="15" fill="${colors.accent}" opacity="0.28"/><circle cx="15" cy="20" r="12.5" fill="${colors.accent}" opacity="0.22"/><rect x="6.5" y="4" width="17" height="30" rx="6" fill="#FFFFFF"/><rect x="9" y="7.5" width="12" height="5" rx="2" fill="${colors.background}" opacity="0.85"/><rect x="9.5" y="25.5" width="11" height="4.5" rx="1.8" fill="${colors.background}" opacity="0.7"/></svg>`;
