import { colors } from '../../theme/tokens';

/**
 * §7's Navigate vehicle marker: a pseudo-3D top-down car inside an
 * accent halo, replacing the plain white triangle. Shared verbatim
 * between the native MarkerView (rendered through react-native-svg's
 * SvgXml) and the web adapter's DOM marker so both platforms draw the
 * identical glyph. The camera is heading-up while driving, so "up" on
 * the glyph is the direction of travel - same contract the old
 * triangle documented.
 *
 * Deliberately a detailed 2D glyph rather than a true 3D model layer:
 * at ~45px screen height the extra dimensionality of a rendered model
 * is invisible, and a model layer would add a render pass on top of
 * terrain + buildings + hillshade + the route glow stack for zero
 * visible gain.
 */
export const DRIVER_CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44"><defs><linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#DDE4E9"/><stop offset="1" stop-color="#B7C1C8"/></linearGradient><linearGradient id="carGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3A48"/><stop offset="1" stop-color="${colors.background}"/></linearGradient></defs><circle cx="16" cy="22" r="16" fill="${colors.accent}" opacity="0.28"/><circle cx="16" cy="22" r="13.5" fill="${colors.accent}" opacity="0.22"/><rect x="4.2" y="12" width="2.6" height="4.5" rx="1.2" fill="#AEB8BF"/><rect x="25.2" y="12" width="2.6" height="4.5" rx="1.2" fill="#AEB8BF"/><path d="M9.5 5 Q9.5 2.5 12.5 2 L19.5 2 Q22.5 2.5 22.5 5 L24 12.5 Q25 20 24 28 L23.3 35 Q22.8 39 19 39.5 L13 39.5 Q9.2 39 8.7 35 L8 28 Q7 20 8 12.5 Z" fill="url(#carBody)" stroke="${colors.background}" stroke-opacity="0.4" stroke-width="0.8"/><path d="M10 8.5 Q16 6.5 22 8.5 L21.4 13.5 Q16 12 10.6 13.5 Z" fill="url(#carGlass)"/><path d="M11 30.5 L21 30.5 L21.6 34 Q16 36 10.4 34 Z" fill="url(#carGlass)" opacity="0.85"/><rect x="12.5" y="15" width="7" height="13" rx="3" fill="#FFFFFF" opacity="0.35"/><circle cx="10.6" cy="3.4" r="1.1" fill="#FFF6D8"/><circle cx="21.4" cy="3.4" r="1.1" fill="#FFF6D8"/></svg>`;
