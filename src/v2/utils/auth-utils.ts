// auth-utils.ts
// One place that turns a spec's auth declaration into Wrekenfile output, shared
// by the OpenAPI v3, Swagger v2 and Postman converters.
//
// Contract for auth headers: an auth header's value in HTTP.HEADERS is never a
// literal credential - it is the name of a DEFAULTS key (e.g.
// "Authorization: bearer_token" with DEFAULTS.bearer_token = "Bearer <TOKEN>").
// Every converter must emit the matching DEFAULTS entry for each key it
// references, so a runtime can tell a reference from a literal header value.

import {
  HEADER_AUTHORIZATION,
  AUTH_BEARER_TOKEN,
  AUTH_BASIC_AUTH,
  AUTH_DIGEST_AUTH,
  AUTH_ID_TOKEN,
  AUTH_TEMPLATE_BEARER,
  AUTH_TEMPLATE_BEARER_ACCESS,
  AUTH_TEMPLATE_BASIC,
  AUTH_TEMPLATE_DIGEST,
  AUTH_TEMPLATE_ID_TOKEN,
} from './constants';

/** Where one auth credential goes on the request. */
export interface AuthPlacement {
  /** Header name -> DEFAULTS key it references. */
  headers: Record<string, string>;
  /** Query/cookie parameters carrying a credential (apiKey not in a header). */
  params: Array<{ name: string; location: 'query' | 'cookie' }>;
  /** DEFAULTS key -> placeholder template. */
  defaults: Record<string, string>;
}

export function emptyAuthPlacement(): AuthPlacement {
  return { headers: {}, params: [], defaults: {} };
}

/** Merges src into dst. For DEFAULTS the first value for a key wins. */
export function mergeAuthPlacement(dst: AuthPlacement, src: AuthPlacement): AuthPlacement {
  Object.assign(dst.headers, src.headers);
  for (const p of src.params) {
    if (!dst.params.some((q) => q.name === p.name && q.location === p.location)) {
      dst.params.push(p);
    }
  }
  for (const [k, v] of Object.entries(src.defaults)) {
    if (!(k in dst.defaults)) dst.defaults[k] = v;
  }
  return dst;
}

/** DEFAULTS key for an apiKey sent in a header: the header name, lowercased. */
export function apiKeyHeaderRef(headerName: string): string {
  return headerName.toLowerCase();
}

function apiKeyPlacement(name: string, location: string): AuthPlacement {
  const out = emptyAuthPlacement();
  if (!name) return out;
  const loc = (location || 'header').toLowerCase();
  const template = `<${name.toUpperCase()}>`;
  if (loc === 'header') {
    out.headers[name] = apiKeyHeaderRef(name);
    out.defaults[apiKeyHeaderRef(name)] = template;
  } else if (loc === 'query' || loc === 'cookie') {
    out.params.push({ name, location: loc });
    out.defaults[`${loc}_${name.toLowerCase()}`] = template;
  }
  return out;
}

function authorizationPlacement(key: string, template: string): AuthPlacement {
  return { headers: { [HEADER_AUTHORIZATION]: key }, params: [], defaults: { [key]: template } };
}

/**
 * HTTP auth scheme (RFC 7235 scheme names are case-insensitive, so "Bearer",
 * "bearer" and "BEARER" are the same scheme).
 */
export function httpSchemePlacement(scheme: string): AuthPlacement {
  const s = String(scheme || '').trim().toLowerCase();
  if (s === 'bearer') return authorizationPlacement(AUTH_BEARER_TOKEN, AUTH_TEMPLATE_BEARER);
  if (s === 'basic') return authorizationPlacement(AUTH_BASIC_AUTH, AUTH_TEMPLATE_BASIC);
  if (s === 'digest') return authorizationPlacement(AUTH_DIGEST_AUTH, AUTH_TEMPLATE_DIGEST);
  if (!s) return emptyAuthPlacement();
  const key = `${s.replace(/[^a-z0-9]+/g, '_')}_auth`;
  return authorizationPlacement(key, `<${key.toUpperCase().replace(/_AUTH$/, '')}_CREDENTIALS>`);
}

/**
 * An OpenAPI v3 securityScheme or a Swagger v2 securityDefinition. Swagger v2
 * has type "basic" where v3 has type "http" + scheme "basic".
 */
export function openApiSchemePlacement(scheme: any): AuthPlacement {
  if (!scheme || typeof scheme !== 'object') return emptyAuthPlacement();
  const type = String(scheme.type || '').toLowerCase();
  if (type === 'http') return httpSchemePlacement(scheme.scheme);
  if (type === 'basic') return httpSchemePlacement('basic');
  if (type === 'apikey') return apiKeyPlacement(scheme.name, scheme.in);
  if (type === 'oauth2') return authorizationPlacement(AUTH_BEARER_TOKEN, AUTH_TEMPLATE_BEARER_ACCESS);
  if (type === 'openidconnect') return authorizationPlacement(AUTH_ID_TOKEN, AUTH_TEMPLATE_ID_TOKEN);
  return emptyAuthPlacement();
}

/**
 * Placement for one operation: the first entry of `security` only. Entries are
 * alternatives (any one satisfies it); only the schemes inside one entry are
 * combined. Emitting every alternative sends extra auth headers with
 * placeholder values, which some APIs reject even next to a valid credential
 * (CreateOS answers 401 to a valid X-Api-Key sent with X-Auth-Token: x-auth-token).
 */
export function operationAuthPlacement(security: any, schemes: Record<string, any> | undefined): AuthPlacement {
  const out = emptyAuthPlacement();
  if (!Array.isArray(security) || security.length === 0) return out;
  const first = security[0];
  if (!first || typeof first !== 'object') return out;
  for (const schemeName of Object.keys(first)) {
    mergeAuthPlacement(out, openApiSchemePlacement(schemes?.[schemeName]));
  }
  return out;
}

/**
 * Where an OpenAPI/Swagger operation's credential goes: its security
 * requirement, plus an Authorization header parameter (any casing) when no
 * scheme already covers that header - classified by its example/default
 * scheme word. params must already be merged and $ref-resolved.
 */
export function operationAuth(params: any[] | undefined, security: any, schemes: Record<string, any> | undefined): AuthPlacement {
  const auth = operationAuthPlacement(security, schemes);
  const isAuthorization = (name: unknown) => typeof name === 'string' && name.toLowerCase() === HEADER_AUTHORIZATION.toLowerCase();
  if (!Object.keys(auth.headers).some(isAuthorization)) {
    const param = (params || []).find((p: any) => p && typeof p === 'object' && p.in === 'header' && isAuthorization(p.name));
    if (param) {
      mergeAuthPlacement(auth, authorizationValuePlacement(param.example ?? param.schema?.example ?? param.schema?.default ?? param.default));
    }
  }
  return auth;
}

/**
 * INPUTS for credentials sent outside headers (apiKey in: query or cookie),
 * unless the operation already declares that parameter. Optional: a runtime may
 * fill a query key from the stored credential (see SECURITY), so a caller need
 * not pass it; a cookie key the caller passes is sent as a Cookie pair.
 */
export function credentialInputs(auth: AuthPlacement, declared: any[]): any[] {
  const declaredNames = new Set(
    declared.flatMap((p) => Object.entries<any>(p).map(([name, d]) => `${String(d?.LOCATION).toLowerCase()}:${name}`))
  );
  return auth.params
    .filter((p) => !declaredNames.has(`${p.location}:${p.name}`))
    .map((p) => ({ [p.name]: { TYPE: 'STRING', REQUIRED: false, LOCATION: p.location } }));
}

/** DEFAULTS for every declared scheme, so documentation lists all of them. */
export function allSchemesDefaults(schemes: Record<string, any> | undefined): Record<string, string> {
  const out = emptyAuthPlacement();
  for (const scheme of Object.values(schemes || {})) {
    mergeAuthPlacement(out, openApiSchemePlacement(scheme));
  }
  return out.defaults;
}

/**
 * Classifies a literal Authorization header value (e.g. from a Postman
 * request or an Authorization parameter) by its scheme word. Anything that
 * isn't Basic or Digest is treated as a bearer token, the common case.
 */
export function authorizationValuePlacement(value: unknown): AuthPlacement {
  const v = typeof value === 'string' ? value.trim() : '';
  const word = (v.match(/^([A-Za-z][A-Za-z0-9_-]*)\s/)?.[1] || '').toLowerCase();
  if (word === 'basic') return httpSchemePlacement('basic');
  if (word === 'digest') return httpSchemePlacement('digest');
  return httpSchemePlacement('bearer');
}

/** Reads one field of a Postman auth block (v2.1 list form or v2.0 object form). */
function postmanAuthParam(auth: any, type: string, key: string): any {
  const block = auth?.[type];
  if (Array.isArray(block)) {
    const entry = block.find((e: any) => e && e.key === key);
    return entry ? entry.value : undefined;
  }
  if (block && typeof block === 'object') return block[key];
  return undefined;
}

/**
 * A Postman auth block (request, folder or collection `auth`). Callers resolve
 * inheritance first; a "noauth" block yields no placement.
 */
export function postmanAuthPlacement(auth: any): AuthPlacement {
  const type = String(auth?.type || '').toLowerCase();
  switch (type) {
    case 'bearer':
    case 'jwt':
      return httpSchemePlacement('bearer');
    case 'basic':
      return httpSchemePlacement('basic');
    case 'digest':
      return httpSchemePlacement('digest');
    case 'oauth2':
      return authorizationPlacement(AUTH_BEARER_TOKEN, AUTH_TEMPLATE_BEARER_ACCESS);
    case 'apikey': {
      const name = postmanAuthParam(auth, 'apikey', 'key') || 'X-API-Key';
      const location = postmanAuthParam(auth, 'apikey', 'in') || 'header';
      return apiKeyPlacement(String(name), String(location));
    }
    default:
      return emptyAuthPlacement();
  }
}

/**
 * The auth block that applies to a Postman request: its own, else the nearest
 * enclosing folder's, else the collection's. A block of type "inherit" (or no
 * block) defers to the parent; "noauth" stops the search with no auth.
 */
export function effectivePostmanAuth(requestAuth: any, ancestorAuths: any[]): any | null {
  for (const auth of [requestAuth, ...ancestorAuths]) {
    if (!auth || typeof auth !== 'object') continue;
    const type = String(auth.type || '').toLowerCase();
    if (!type || type === 'inherit') continue;
    return type === 'noauth' ? null : auth;
  }
  return null;
}
