/**
 * Police notices publish local calendar dates ("17/09/2026"), not
 * instants - an alert window like "camera operates on 17/09" means
 * 00:00-23:59 in the issuing state's timezone. These helpers convert a
 * local date (or date range) plus an IANA zone into UTC ISO strings for
 * NormalizedAlert.first_seen/expires_at, without a tz library.
 */

/** "17/09/2026" -> { year: 2026, month: 9, day: 17 }. Returns null on
 * anything that isn't exactly DD/MM/YYYY. */
function parseAuDate(text) {
  const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
}

/** Offset (ms) of `tz` ahead of UTC at the instant `utcDate`, derived by
 * formatting that instant in the zone and diffing against itself. The
 * instant is floored to whole seconds first: formatToParts has no
 * sub-second field, so a .999 input would otherwise leak its
 * milliseconds into the diff and skew results by ~1s. */
function zoneOffsetMs(tz, utcDate) {
  const floored = new Date(Math.floor(utcDate.getTime() / 1000) * 1000);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of dtf.formatToParts(floored)) parts[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - floored.getTime();
}

/** Wall-clock time in `tz` -> UTC instant. Two-pass: the offset used to
 * convert can itself shift across a DST boundary, so the first guess is
 * re-checked against the offset at the guessed instant. */
function localTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, tz) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let instant = naiveUtc - zoneOffsetMs(tz, new Date(naiveUtc));
  const corrected = naiveUtc - zoneOffsetMs(tz, new Date(instant));
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** Local date range -> UTC ISO strings covering whole local days:
 * start 00:00:00.000 through end 23:59:59.999 in `tz`. `endDate` may be
 * omitted for single-day notices. */
function localDateWindowToUtc(startDate, endDate, tz) {
  const end = endDate ?? startDate;
  const startUtc = localTimeToUtc({ ...startDate }, tz);
  const endUtc = localTimeToUtc({ ...end, hour: 23, minute: 59, second: 59, ms: 999 }, tz);
  return { first_seen: startUtc.toISOString(), expires_at: endUtc.toISOString() };
}

module.exports = { parseAuDate, localDateWindowToUtc };
