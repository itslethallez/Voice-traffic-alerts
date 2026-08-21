export const colors = {
  background: '#0A0A0C',
  backgroundAccent: '#12121C',
  ink: '#F5F5F7',
  inkMuted: 'rgba(245, 245, 247, 0.6)',
  inkFaint: 'rgba(245, 245, 247, 0.35)',
  accent: '#6C8CFF',
  accentDim: '#3A4A8C',
  warning: '#E8B04B',
  muteButtonIdle: '#1C1C24',
  muteButtonActive: '#2A2A38',
  /** The Report-dial's lime accent (Step 11b) - deliberately far from
   * `accent`'s blue (driver/police) and `warning`'s amber (hazards/jams)
   * so the one control the driver actively presses reads as visually
   * distinct from anything the app itself is reporting. */
  report: '#C6FF3D',
  reportDim: 'rgba(198, 255, 61, 0.18)',
  /** Police radar marker's flashing lights (Step 12 #24) - deliberately
   * saturated, unlike the muted `accent` blue used for the marker's static
   * meta color, so the flash reads as an emergency-light effect. */
  policeLightBlue: '#3D6BFF',
  policeLightRed: '#FF3D3D',
} as const;
