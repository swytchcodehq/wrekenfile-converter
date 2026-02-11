/**
 * Deterministic canonical method ID generation.
 * Format: <namespace>.<resource>.<action>
 * No HTTP method or path params in name; semantic only.
 */

/** Known action verbs (fixed dictionary) */
const STANDARD_VERBS = new Set([
  'list', 'get', 'create', 'update', 'delete', 'install', 'remove', 'execute',
  'retry', 'initialize', 'upload', 'download', 'connect', 'invite', 'restart',
]);

/** Verb-first form for compound actions (kebab segment → camelCase with verb first) */
const VERB_PREFIXES = ['remove', 'install', 'execute', 'upload', 'download', 'retry', 'connect'];

/** Irregular plural → singular */
const IRREGULAR_SINGULAR: Record<string, string> = {
  policies: 'policy',
  countries: 'country',
  categories: 'category',
  buckets: 'bucket',
  clusters: 'cluster',
  accounts: 'account',
  continents: 'continent',
  identities: 'identity',
  utilities: 'utility',
};

/**
 * Normalize path: strip leading slash and version prefix only.
 * First segment = namespace (api, admin, partner, etc.); do not strip it.
 */
function normalizePath(path: string): string {
  let p = path.replace(/^\/+/, '').trim();
  // Strip version prefix: /v1/, /v2/, /v3/
  p = p.replace(/^v\d+\//i, '');
  return p.replace(/\/+$/, '');
}

/**
 * Split path into segments and remove path-parameter segments ({id}, {foo}, etc).
 */
function pathSegmentsWithoutParams(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  return segments.filter((s) => !/^\{[^}]+\}$/.test(s) && !/^\{[^}]*\}$/.test(s));
}

/**
 * Singularize a resource name (simple rules + irregular map).
 */
function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_SINGULAR[lower]) return IRREGULAR_SINGULAR[lower];
  if (lower.endsWith('ies') && lower.length > 4) return lower.slice(0, -3) + 'y';
  if (lower.endsWith('ses') || lower.endsWith('xes') || lower.endsWith('zes'))
    return lower.slice(0, -2);
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 1)
    return lower.slice(0, -1);
  return lower;
}

/**
 * Convert kebab-case or snake_case to camelCase.
 */
function toCamelCase(segment: string): string {
  return segment
    .replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/**
 * For a trailing action segment like "helm-release-remove", produce "removeHelmRelease".
 * If segment is a single noun (e.g. "shell"), produce "executeShell".
 */
function actionSegmentToCamel(segment: string): string {
  const lower = segment.toLowerCase();
  for (const verb of VERB_PREFIXES) {
    if (lower.endsWith('-' + verb)) {
      const rest = segment.slice(0, -(verb.length + 1));
      return verb + toCamelCase(rest).replace(/^(.)/, (_, c) => c.toUpperCase());
    }
  }
  const camel = toCamelCase(segment);
  // Single-word noun (e.g. "shell") -> executeShell when not a standard verb
  if (!segment.includes('-') && !segment.includes('_') && !STANDARD_VERBS.has(lower)) {
    return 'execute' + camel.charAt(0).toUpperCase() + camel.slice(1);
  }
  return camel;
}

/**
 * Compute base canonical ID from HTTP method and path. Deterministic; no collision handling.
 * Format: namespace.resource.action
 */
export function computeCanonicalId(httpMethod: string, path: string): string {
  const normalized = normalizePath(path);
  const segments = pathSegmentsWithoutParams(normalized);

  const method = (httpMethod || 'GET').toUpperCase();

  // Default namespace if path is empty or only had params
  const namespace = segments.length > 0 ? segments[0].toLowerCase() : 'api';
  const resource =
    segments.length > 1 ? singularize(segments[1]) : singularize(segments[0] || 'resource');
  const hasIdInPath = /\/\{[^}]+\}(\/|$)/.test(path);

  // Action: map HTTP + path shape to verb or custom action
  let action: string;

  if (segments.length <= 2) {
    // Base resource path: /api/clusters or /api/clusters/{id}
    switch (method) {
      case 'GET':
        action = hasIdInPath ? 'get' : 'list';
        break;
      case 'POST':
        action = 'create';
        break;
      case 'PUT':
      case 'PATCH':
        action = 'update';
        break;
      case 'DELETE':
        action = 'delete';
        break;
      default:
        action = method.toLowerCase();
    }
  } else {
    // Extra segments: e.g. /api/clusters/{id}/install-promstack
    const actionSegments = segments.slice(2);
    action = actionSegments.map((s) => actionSegmentToCamel(s)).join('');
    if (!action) action = method === 'POST' ? 'create' : 'execute';
  }

  return `${namespace}.${resource}.${action}`;
}

/**
 * Create a short deterministic hash from a string (for collision fallback).
 */
function shortHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = (h << 5) - h + c;
    h = h & 0xffff;
  }
  return Math.abs(h).toString(16).slice(0, 4);
}

export interface MethodCanonicalInput {
  methodId: string;
  httpMethod?: string;
  endpoint?: string;
  existingCanonicalId?: string;
}

/**
 * Resolve canonical IDs for all methods with collision handling:
 * 1. Use existing CANONICAL_ID if provided.
 * 2. Else compute base ID from HTTP + path.
 * 3. On collision: extend with next path segment (subresource).
 * 4. If still colliding: append short deterministic hash.
 */
export function resolveCanonicalIds(
  methods: MethodCanonicalInput[]
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Map<string, string>(); // canonicalId -> methodId (first claimant)

  function tryAssign(methodId: string, canonicalId: string): boolean {
    const existing = used.get(canonicalId);
    if (existing === undefined || existing === methodId) {
      used.set(canonicalId, methodId);
      return true;
    }
    return false;
  }

  // First pass: assign existing or base canonical IDs; collect collisions
  const pending: { methodId: string; httpMethod: string; endpoint: string; baseId: string }[] = [];

  for (const m of methods) {
    if (m.existingCanonicalId && /^[a-z0-9]+\.[a-z0-9]+\.[a-zA-Z0-9]+$/.test(m.existingCanonicalId)) {
      const cid = m.existingCanonicalId;
      if (tryAssign(m.methodId, cid)) {
        result.set(m.methodId, cid);
      } else {
        pending.push({
          methodId: m.methodId,
          httpMethod: m.httpMethod || 'GET',
          endpoint: m.endpoint || '',
          baseId: cid,
        });
      }
      continue;
    }
    if (m.httpMethod && m.endpoint) {
      const baseId = computeCanonicalId(m.httpMethod, m.endpoint);
      if (tryAssign(m.methodId, baseId)) {
        result.set(m.methodId, baseId);
      } else {
        pending.push({
          methodId: m.methodId,
          httpMethod: m.httpMethod,
          endpoint: m.endpoint,
          baseId,
        });
      }
    } else {
      // No HTTP info (e.g. SDK-only): use methodId as basis, sanitized
      const fallback = m.methodId
        .toLowerCase()
        .replace(/^([a-z]+)--/, '$1.')
        .replace(/--/g, '.')
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9.]/g, '');
      const baseId = fallback || 'sdk.method.' + shortHash(m.methodId);
      let cid = baseId;
      if (!tryAssign(m.methodId, cid)) cid = baseId + '_' + shortHash(m.methodId);
      result.set(m.methodId, cid);
    }
  }

  // Resolve pending collisions: extend with next path segment (subresource.action), then hash
  for (const p of pending) {
    const normalized = normalizePath(p.endpoint);
    const segments = pathSegmentsWithoutParams(normalized);
    let candidate = p.baseId;
    
    // Try extending with subresource segments
    if (segments.length > 2) {
      const extra = segments.slice(2);
      const subAction = extra.map((s) => actionSegmentToCamel(s)).join('');
      if (subAction) {
        // e.g. api.cluster.restart -> api.cluster.machineRestart
        const prefix = p.baseId.replace(/\.[^.]+$/, '');
        candidate = prefix + '.' + subAction.charAt(0).toLowerCase() + subAction.slice(1);
      }
    }
    
    // Try assigning the candidate (may still collide if multiple pending items extend to same candidate)
    if (!tryAssign(p.methodId, candidate)) {
      // Still colliding: use hash-based fallback (guaranteed unique per methodId)
      // Hash includes methodId which is unique, so this will always succeed
      candidate = p.baseId + '_' + shortHash(p.endpoint + p.methodId);
      // Ensure uniqueness: if hash somehow collides (extremely rare), append methodId hash
      let finalCandidate = candidate;
      let attempts = 0;
      while (!tryAssign(p.methodId, finalCandidate) && attempts < 10) {
        finalCandidate = p.baseId + '_' + shortHash(p.endpoint + p.methodId + attempts.toString());
        attempts++;
      }
      candidate = finalCandidate;
    }
    result.set(p.methodId, candidate);
  }

  // Final validation: ensure no duplicates (safety check)
  const seen = new Map<string, string>(); // canonicalId -> first methodId that used it
  const duplicates = new Map<string, string>(); // methodId -> canonicalId (duplicate)
  
  for (const [methodId, canonicalId] of result.entries()) {
    const firstUser = seen.get(canonicalId);
    if (firstUser !== undefined) {
      // Duplicate found
      duplicates.set(methodId, canonicalId);
    } else {
      seen.set(canonicalId, methodId);
    }
  }
  
  if (duplicates.size > 0) {
    // This should never happen with proper hash fallback, but if it does, force unique IDs
    console.warn(`Warning: Found ${duplicates.size} duplicate canonical ID(s), forcing uniqueness`);
    for (const [methodId, canonicalId] of duplicates.entries()) {
      // Force unique by appending methodId hash
      const uniqueId = canonicalId + '_' + shortHash(methodId);
      result.set(methodId, uniqueId);
    }
  }

  return result;
}
