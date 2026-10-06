// openapi-utils.ts
// Spec-level helpers shared by the OpenAPI v3 and Swagger v2 converters.

import type { RefResolver } from './ref-utils';

/**
 * Path-level parameters merged with operation-level ones. Per the OpenAPI spec
 * an operation parameter overrides a path parameter with the same name and
 * location; it must not be emitted twice. $refs are resolved so the override
 * can be matched. Order: path parameters first (overrides keep their slot),
 * then the operation's new ones.
 */
export function mergeParameters(pathParams: any[] | undefined, opParams: any[] | undefined, resolver?: RefResolver): any[] {
  const merged: any[] = [];
  const index = new Map<string, number>();
  const resolve = (p: any) => (p && typeof p === 'object' && p.$ref && resolver ? resolver.resolveRef(p.$ref) : p);
  const keyOf = (p: any) =>
    p && typeof p === 'object' && typeof p.name === 'string' ? `${String(p.in || 'query').toLowerCase()}:${p.name}` : undefined;

  for (const raw of [...(pathParams || []), ...(opParams || [])]) {
    const param = resolve(raw);
    const key = keyOf(param);
    if (key !== undefined && index.has(key)) {
      merged[index.get(key)!] = param;
      continue;
    }
    if (key !== undefined) index.set(key, merged.length);
    merged.push(param);
  }
  return merged;
}

/**
 * An OpenAPI v3 server URL with its {variables} filled from each variable's
 * default (or first enum value). A variable with neither is left as {name}, so
 * runtimes that detect placeholders can still ask the user for it.
 */
export function resolveServerUrl(server: any): string | undefined {
  const url = server?.url;
  if (typeof url !== 'string' || !url) return undefined;
  const variables = server.variables && typeof server.variables === 'object' ? server.variables : {};
  return url.replace(/\{([^{}]+)\}/g, (match: string, name: string) => {
    const v = variables[name];
    const value = v?.default ?? (Array.isArray(v?.enum) ? v.enum[0] : undefined);
    return value !== undefined && value !== null && value !== '' ? String(value) : match;
  });
}

/**
 * The operations to convert. OpenAPI 3.1 `webhooks` are requests the API sends
 * to the consumer, not endpoints to call, so they are skipped when the spec
 * has real paths. A webhook-only spec is converted from its webhooks (as the
 * backend has always done) with each name as a path.
 */
export function getPathLikeObjects(spec: any): Array<{ pathStr: string; pathMethods: any; isWebhook: boolean }> {
  const paths = spec.paths && typeof spec.paths === 'object' ? Object.entries<any>(spec.paths) : [];
  if (paths.length > 0) {
    return paths.map(([k, v]) => ({ pathStr: k, pathMethods: v, isWebhook: false }));
  }
  const webhooks = spec.webhooks && typeof spec.webhooks === 'object' ? Object.entries<any>(spec.webhooks) : [];
  return webhooks.map(([k, v]) => ({ pathStr: k.startsWith('/') ? k : `/${k}`, pathMethods: v, isWebhook: true }));
}
