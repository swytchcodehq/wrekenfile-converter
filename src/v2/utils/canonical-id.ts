/**
 * Deterministic canonical method ID generation.
 * Format: <namespace>.<resource>.<action>
 * No HTTP method or path params in name; semantic only.
 */

/** Known action verbs (fixed dictionary) */
const STANDARD_VERBS = new Set([
  'list',
  'get',
  'create',
  'update',
  'delete',
  'install',
  'remove',
  'execute',
  'retry',
  'initialize',
  'upload',
  'download',
  'connect',
  'invite',
  'restart',
  'generate',
  'refresh',
  'check',
  'validate',
  'migrate',
  'cancel',
  'refund',
  'suspend',
  'approve',
  'reject',
  'start',
  'stop',
  'pause',
  'resume',
]);

/** Verb-first form for compound actions (kebab segment → camelCase with verb first) */


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
  p = p.replace(/\.json$/i, '');
  p = p.replace(/\.xml$/i, '');
  return p.replace(/\/+$/, '');
}

/**
 * Split path into segments and remove path-parameter segments ({id}, {foo}, :id, etc).
 */
function pathSegmentsWithoutParams(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  return segments.filter((s) => {
    // Remove {param} style
    if (s.startsWith('{') && s.endsWith('}')) return false;
    // Remove :param style
    if (s.startsWith(':')) return false;
    return true;
  });
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
 * For an action-related segment:
 * - If it ends with "-<verb>", move verb to front: "helm-release-remove" -> "removeHelmRelease"
 * - If it's a single noun (e.g. "shell"), produce "executeShell"
 * - Otherwise, just kebab/snake -> camelCase
 */

/**
 * Extract the primary verb for a method from remaining path segments and HTTP method.
 * SINGLE VERB RULE: only one verb is allowed; we keep the first one we find.
 */
function extractPrimaryVerb(
  remaining: string[],
  httpMethod: string,
  hasIdInPath: boolean
): string {
  const foundVerbs: string[] = [];

  for (const segment of remaining) {
    const lower = segment.toLowerCase();

    // Segment exactly matches a verb
    if (STANDARD_VERBS.has(lower)) {
      foundVerbs.push(lower);
      continue;
    }

    // Segment ends with -verb (e.g. "helm-release-remove")
    for (const verb of STANDARD_VERBS) {
      if (lower.endsWith('-' + verb)) {
        foundVerbs.push(verb as string);
        break;
      }
    }
  }

  if (foundVerbs.length > 0) {
    // SINGLE VERB RULE: first verb only, ignore all others
    return foundVerbs[0];
  }

  // Fallback: derive verb from HTTP method
  switch ((httpMethod || 'GET').toUpperCase()) {
    case 'GET':
      return hasIdInPath ? 'get' : 'list';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'execute';
  }
}

/**
 * Extract at most ONE subresource from remaining segments, based on nouns before the verb.
 * We pick the last meaningful noun before the verb (most specific).
 */
function extractSubresource(remaining: string[], _verb: string): string | null {
  if (remaining.length === 0) return null;

  // Find index of the verb in remaining segments (if present)
  const verbIndex = remaining.findIndex((s) => {
    const lower = s.toLowerCase();
    if (STANDARD_VERBS.has(lower)) return true;
    const parts = lower.split('-');
    return parts.length > 1 && STANDARD_VERBS.has(parts[parts.length - 1] || '');
  });

  const beforeVerb =
    verbIndex >= 0 ? remaining.slice(0, verbIndex) : remaining;

  if (beforeVerb.length === 0) return null;

  // Walk backwards to find last noun-like segment (not a verb)
  for (let i = beforeVerb.length - 1; i >= 0; i--) {
    const segment = beforeVerb[i];
    const lower = segment.toLowerCase();
    if (STANDARD_VERBS.has(lower)) continue;
    return toCamelCase(segment);
  }

  return null;
}

/**
 * Compute base canonical ID from HTTP method and path. Deterministic; no collision handling.
 * Enforces grammar: <namespace>.<resource>[.<subresource>].<action>
 */
export function computeCanonicalId(libraryName: string, httpMethod: string, path: string): string {
  const normalized = normalizePath(path);
  const segments = pathSegmentsWithoutParams(normalized);

  const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'api';
  
  if (segments.length === 0) {
    return `${namespace}.resource.execute`;
  }

  const method = (httpMethod || 'GET').toUpperCase();

  // primary resource
  const resource = singularize(segments[0] || 'resource');

  const remaining = segments.slice(1);
  const hasIdInPath =
    /\/\{[^}]+\}(\/|$)/.test(path) || /\/:[^/]+(\/|$)/.test(path);

  // SINGLE VERB RULE: extract one primary verb
  const verb = extractPrimaryVerb(remaining, method, hasIdInPath);

  // Optional subresource (at most one)
  const subresource = extractSubresource(remaining, verb);

  const parts: string[] = [namespace, resource];
  if (subresource) {
    parts.push(subresource);
  }
  parts.push(verb);

  // MAX 4 SEGMENTS RULE: if exceeded, collapse to namespace.resource.verb
  let rawId: string;
  if (parts.length > 4) {
    rawId = [parts[0], parts[1], parts[parts.length - 1]].join('.');
  } else {
    rawId = parts.join('.');
  }

  // Sanitize to remove special characters. Only alphanumeric, dot, dash, and underscore are allowed.
  return rawId.replace(/[^a-zA-Z0-9.\-_]/g, '');
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
  methods: MethodCanonicalInput[],
  libraryName: string
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
      const baseId = computeCanonicalId(libraryName, m.httpMethod, m.endpoint);
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
      const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'sdk';
      const fallback = m.methodId
        .toLowerCase()
        .replace(/^([a-z]+)--/, '$1.')
        .replace(/--/g, '.')
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9.]/g, '');
      const baseId = fallback || `${namespace}.method`;
      let cid = baseId;
      if (!tryAssign(m.methodId, cid)) {
          pending.push({ methodId: m.methodId, httpMethod: m.httpMethod || 'GET', endpoint: m.endpoint || '', baseId });
      } else {
          result.set(m.methodId, cid);
      }
    }
  }

  // Resolve pending collisions: use counter suffix for uniqueness (no hashes)
  for (const p of pending) {
    let finalCandidate = p.baseId;
    let attempts = 1;
    while (!tryAssign(p.methodId, finalCandidate) && attempts < 100) {
      finalCandidate = `${p.baseId}.${attempts}`;
      attempts++;
    }
    result.set(p.methodId, finalCandidate);
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
    // Force uniqueness with a fallback counter if something incredibly went wrong
    console.warn(`Warning: Found ${duplicates.size} duplicate canonical ID(s), forcing uniqueness`);
    for (const [methodId, canonicalId] of duplicates.entries()) {
      let uniqueId = canonicalId;
      let counter = 1;
      while(seen.has(uniqueId) && seen.get(uniqueId) !== methodId) {
          uniqueId = `${canonicalId}.fallback${counter}`;
          counter++;
      }
      seen.set(uniqueId, methodId);
      result.set(methodId, uniqueId);
    }
  }

  return result;
}
