import type { FacebookNotificationEvent } from './facebookNotificationIntake.types';

export type CommunityNotificationCategory =
  | 'POLICE'
  | 'ACCIDENT'
  | 'HAZARD'
  | 'ROAD_CLOSED'
  | 'JAM';

export type CommunityNotificationDecision = 'eligible' | 'review';

export type SortedFacebookNotification = {
  source: 'facebook_notification';
  sourceRef: string;
  capturedAtMs: number;
  category: CommunityNotificationCategory;
  subtype: string | null;
  locationText: string | null;
  direction: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | null;
  /** Deliberately composed from normalized fields; raw notification text is not retained. */
  summary: string;
  confidence: number;
  decision: CommunityNotificationDecision;
};

type IncidentRule = {
  category: CommunityNotificationCategory;
  pattern: RegExp;
  specificity: RegExp;
};

const FACEBOOK_PACKAGE_NAME = 'com.facebook.katana';
const MAX_FIELD_LENGTH = 500;
const MAX_KEY_LENGTH = 512;

const INCIDENT_RULES: IncidentRule[] = [
  {
    category: 'ACCIDENT',
    pattern: /\b(accident|crash|collision|rollover|pile[- ]?up)\b/i,
    specificity: /\b(rear[- ]?ended|multi[- ]?vehicle|injur(?:y|ies)|overturned)\b/i,
  },
  {
    category: 'ROAD_CLOSED',
    pattern: /\b(road|lane|street|highway)\s+(?:is\s+)?(?:closed|blocked)\b|\bclosure\b/i,
    specificity: /\b(full|both|all)\s+(?:road|lanes?)\b/i,
  },
  {
    category: 'POLICE',
    pattern: /\b(police|cop(?:s)?|speed\s+camera|radar|rbt|breath(?:alyser|alizer)?|patrol)\b/i,
    specificity: /\b(speed\s+camera|radar|rbt|breath(?:alyser|alizer)?)\b/i,
  },
  {
    category: 'HAZARD',
    pattern: /\b(hazard|debris|pothole|obstruction|broken[- ]?down|fallen\s+tree|object\s+on\s+road)\b/i,
    specificity: /\b(debris|pothole|fallen\s+tree|object\s+on\s+road)\b/i,
  },
  {
    category: 'JAM',
    pattern: /\b(traffic|congestion|standstill|queue|queued|gridlock|slow[- ]?moving)\b/i,
    specificity: /\b(standstill|gridlock|traffic\s+banked\s+back)\b/i,
  },
];

// Deliberately conservative: only common road suffixes are extracted. The
// output is a location hint for a later geocoder, not an asserted coordinate.
const ROAD_PATTERN = /\b([A-Z][A-Za-z0-9.'’&-]*(?:\s+[A-Za-z0-9.'’&-]+){0,3}\s+(?:Road|Rd|Street|St|Avenue|Ave|Highway|Hwy|Drive|Dr|Boulevard|Blvd|Way|Lane|Ln|Crescent|Cres))\b/i;
const DIRECTION_PATTERN = /\b(?:heading|travelling|traveling|bound|towards?)\s+(north|south|east|west)(?:bound)?\b/i;

function cleanField(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function extractLocation(text: string): string | null {
  const contextualMatch = text.match(
    /\b(?:on|at|near|along|between)\s+([A-Z][A-Za-z0-9.'’&-]*(?:\s+[A-Za-z0-9.'’&-]+){0,3}\s+(?:Road|Rd|Street|St|Avenue|Ave|Highway|Hwy|Drive|Dr|Boulevard|Blvd|Way|Lane|Ln|Crescent|Cres))\b/i,
  );
  if (contextualMatch?.[1]) {
    return contextualMatch[1].replace(/\s+/g, ' ').trim();
  }

  const match = text.match(ROAD_PATTERN);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

function extractDirection(text: string): SortedFacebookNotification['direction'] {
  const direction = text.match(DIRECTION_PATTERN)?.[1]?.toUpperCase();
  return direction === 'NORTH' || direction === 'SOUTH' || direction === 'EAST' || direction === 'WEST'
    ? direction
    : null;
}

function roundConfidence(value: number): number {
  return Math.round(Math.min(0.99, Math.max(0.01, value)) * 100) / 100;
}

/**
 * Sorts one already package-filtered Android notification into a safe,
 * normalized candidate. It never returns raw title/body text and never
 * produces coordinates or an automatic voice-alert payload.
 */
export function sortFacebookNotification(
  event: FacebookNotificationEvent,
): SortedFacebookNotification | null {
  if (
    event.packageName !== FACEBOOK_PACKAGE_NAME ||
    typeof event.notificationKey !== 'string' ||
    event.notificationKey.length === 0 ||
    event.notificationKey.length > MAX_KEY_LENGTH ||
    !Number.isFinite(event.postedAt)
  ) {
    return null;
  }

  const title = cleanField(event.title);
  const body = cleanField(event.text);
  const text = [title, body].filter(Boolean).join(' ');
  if (!text) return null;

  const rule = INCIDENT_RULES.find((candidate) => candidate.pattern.test(text));
  if (!rule) return null;

  const locationText = extractLocation(text);
  const direction = extractDirection(text);
  const confidence = roundConfidence(
    0.55 +
      (locationText ? 0.15 : 0) +
      (direction ? 0.1 : 0) +
      (rule.specificity.test(text) ? 0.15 : 0),
  );
  const decision = confidence >= 0.85 && locationText ? 'eligible' : 'review';
  const subtype = rule.category === 'POLICE' ? 'POLICE_VISIBLE' : null;
  const summary = [rule.category, locationText, direction].filter(Boolean).join(' · ');

  return {
    source: 'facebook_notification',
    sourceRef: event.notificationKey,
    capturedAtMs: event.postedAt,
    category: rule.category,
    subtype,
    locationText,
    direction,
    summary,
    confidence,
    decision,
  };
}
