const fs = require('fs');

let content = fs.readFileSync('src/v2/utils/canonical-id.ts', 'utf8');

const oldVerbs = `const STANDARD_VERBS = new Set([
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
]);`;

const newVerbs = `const STANDARD_VERBS = new Set([
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
]);`;

content = content.replace(oldVerbs, newVerbs);

const oldComputeId = `export function computeCanonicalId(httpMethod: string, path: string): string {
  const normalized = normalizePath(path);
  const segments = pathSegmentsWithoutParams(normalized);

  if (segments.length === 0) {
    return 'api.resource.execute';
  }

  const method = (httpMethod || 'GET').toUpperCase();

  // namespace and primary resource
  const namespace = segments[0].toLowerCase();`;

const newComputeId = `export function computeCanonicalId(libraryName: string, httpMethod: string, path: string): string {
  const normalized = normalizePath(path);
  const segments = pathSegmentsWithoutParams(normalized);

  if (segments.length === 0) {
    return 'api.resource.execute';
  }

  const method = (httpMethod || 'GET').toUpperCase();

  // namespace and primary resource
  const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'api';`;

content = content.replace(oldComputeId, newComputeId);

const oldShortHash = `/**
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
}`;

content = content.replace(oldShortHash, '');

const oldResolveSig = `export function resolveCanonicalIds(
  methods: MethodCanonicalInput[]
): Map<string, string> {`;

const newResolveSig = `export function resolveCanonicalIds(
  methods: MethodCanonicalInput[],
  libraryName: string
): Map<string, string> {`;

content = content.replace(oldResolveSig, newResolveSig);

const oldBaseIdCompute = `const baseId = computeCanonicalId(m.httpMethod, m.endpoint);`;
const newBaseIdCompute = `const baseId = computeCanonicalId(libraryName, m.httpMethod, m.endpoint);`;
content = content.replace(oldBaseIdCompute, newBaseIdCompute);

const oldFallback = `const fallback = m.methodId
        .toLowerCase()
        .replace(/^([a-z]+)--/, '$1.')
        .replace(/--/g, '.')
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9.]/g, '');
      const baseId = fallback || 'sdk.method.' + shortHash(m.methodId);
      let cid = baseId;
      if (!tryAssign(m.methodId, cid)) cid = baseId + '_' + shortHash(m.methodId);
      result.set(m.methodId, cid);`;

const newFallback = `const namespace = libraryName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'sdk';
      const fallback = m.methodId
        .toLowerCase()
        .replace(/^([a-z]+)--/, '$1.')
        .replace(/--/g, '.')
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9.]/g, '');
      const baseId = fallback || \`\${namespace}.method\`;
      let cid = baseId;
      if (!tryAssign(m.methodId, cid)) {
          pending.push({ methodId: m.methodId, httpMethod: m.httpMethod || 'GET', endpoint: m.endpoint || '', baseId });
      } else {
          result.set(m.methodId, cid);
      }`;

content = content.replace(oldFallback, newFallback);

const oldCollision = `// Resolve pending collisions: use hash-based suffix for uniqueness (no extra verbs)
  for (const p of pending) {
    // Always keep the baseId semantic; just append a deterministic hash to disambiguate
    let candidate = p.baseId + '_' + shortHash(p.endpoint + p.methodId);
    let finalCandidate = candidate;
    let attempts = 0;
    while (!tryAssign(p.methodId, finalCandidate) && attempts < 10) {
      finalCandidate = p.baseId + '_' + shortHash(p.endpoint + p.methodId + attempts.toString());
      attempts++;
    }
    result.set(p.methodId, finalCandidate);
  }`;

const newCollision = `// Resolve pending collisions: use counter suffix for uniqueness (no hashes)
  for (const p of pending) {
    let finalCandidate = p.baseId;
    let attempts = 1;
    while (!tryAssign(p.methodId, finalCandidate) && attempts < 100) {
      finalCandidate = \`\${p.baseId}.\${attempts}\`;
      attempts++;
    }
    result.set(p.methodId, finalCandidate);
  }`;

content = content.replace(oldCollision, newCollision);

const oldDuplicate = `// This should never happen with proper hash fallback, but if it does, force unique IDs
    console.warn(\`Warning: Found \${duplicates.size} duplicate canonical ID(s), forcing uniqueness\`);
    for (const [methodId, canonicalId] of duplicates.entries()) {
      // Force unique by appending methodId hash
      const uniqueId = canonicalId + '_' + shortHash(methodId);
      result.set(methodId, uniqueId);
    }`;

const newDuplicate = `// Force uniqueness with a fallback counter if something incredibly went wrong
    console.warn(\`Warning: Found \${duplicates.size} duplicate canonical ID(s), forcing uniqueness\`);
    for (const [methodId, canonicalId] of duplicates.entries()) {
      let uniqueId = canonicalId;
      let counter = 1;
      while(seen.has(uniqueId) && seen.get(uniqueId) !== methodId) {
          uniqueId = \`\${canonicalId}.fallback\${counter}\`;
          counter++;
      }
      seen.set(uniqueId, methodId);
      result.set(methodId, uniqueId);
    }`;

content = content.replace(oldDuplicate, newDuplicate);

// Also fix the foundVerbs type error introduced by TS strict mode in Conor's branch
content = content.replace(/foundVerbs\.push\(verb\);/g, 'foundVerbs.push(verb as string);');

fs.writeFileSync('src/v2/utils/canonical-id.ts', content);
