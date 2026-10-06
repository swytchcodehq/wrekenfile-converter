// media-type-utils.ts
// Media type matching shared by the converters. Specs declare JSON in many
// spellings - "application/json; charset=utf-8", "application/problem+json",
// "application/vnd.api+json" - and all of them carry a JSON schema.

import { CONTENT_TYPE_JSON } from './constants';

/** Lowercased media type without parameters: "Application/JSON; charset=utf-8" -> "application/json". */
export function normalizeMediaType(mediaType: unknown): string {
  if (typeof mediaType !== 'string') return '';
  return mediaType.split(';')[0].trim().toLowerCase();
}

export function isJsonMediaType(mediaType: unknown): boolean {
  const m = normalizeMediaType(mediaType);
  return m === CONTENT_TYPE_JSON || m === 'text/json' || m.endsWith('+json');
}

export function isMediaType(mediaType: unknown, expected: string): boolean {
  return normalizeMediaType(mediaType) === expected;
}

/**
 * The JSON entry of an OpenAPI v3 `content` map: exact application/json first,
 * then any other JSON spelling. Returns undefined when nothing is JSON.
 */
export function findJsonContent(content: any): { mediaType: string; media: any } | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const keys = Object.keys(content);
  const pick =
    keys.find((k) => normalizeMediaType(k) === CONTENT_TYPE_JSON) ||
    keys.find((k) => isJsonMediaType(k));
  return pick ? { mediaType: pick, media: content[pick] } : undefined;
}

/** First JSON media type in a list (Swagger v2 consumes/produces), else the first entry. */
export function preferJsonMediaType(mediaTypes: unknown): string | undefined {
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return undefined;
  const json = mediaTypes.find((m) => isJsonMediaType(m));
  return (json ?? mediaTypes[0]) as string;
}
