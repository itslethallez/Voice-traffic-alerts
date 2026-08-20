/**
 * Ultra-compact marker/chip label - "0.7km"/"12km", not
 * formatAnnouncement.ts's formatDistance ("700 metres"/"12 kilometres"),
 * which would overflow a small map pin. Kept in its own file (no
 * react-native imports) so it's testable in this project's plain
 * ts-jest/node setup, the same way formatDistance is.
 */
export function formatCompactDistance(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}
