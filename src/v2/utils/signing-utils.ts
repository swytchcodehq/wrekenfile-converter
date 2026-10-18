// signing-utils.ts
// Request-signing support (Wrekenfile 2.1.0), shared by the OpenAPI v3,
// Swagger v2 and Postman converters.
//
// APIs such as crypto exchanges need a fresh signature on every request. A
// spec declares how to make it with an `x-swytchcode-signing` recipe, either on
// a security scheme or at the spec root. The converter then:
//   - copies the recipe verbatim into the top-level SIGNING block, named after
//     the scheme (or "request_signature" for a root-level recipe);
//   - gives every method whose security uses it SECURITY: request_signature;
//   - drops every header, query parameter and body field the recipe produces
//     (timestamp, nonce, signature, API key) from HEADERS, INPUTS, STRUCTS and
//     DEFAULTS, so a runtime never sends a placeholder for them and an agent is
//     never asked for them.

/** The extension a spec declares a signing recipe with. */
export const SIGNING_EXTENSION = 'x-swytchcode-signing';

/** SIGNING name for a recipe declared at the spec root. */
export const ROOT_RECIPE_NAME = 'request_signature';

/** The SECURITY type of a signed method. */
export const REQUEST_SIGNATURE_TYPE = 'request_signature';

/** The names one recipe produces, by where it puts them. */
export interface OwnedNames {
  /** Lowercase header names. */
  headers: Set<string>;
  query: Set<string>;
  body: Set<string>;
}

/** What the converter needs to know about a spec's signing recipes. */
export interface SigningInfo {
  /** SIGNING block: recipe name -> recipe, copied verbatim. */
  recipes: Record<string, any>;
  /** Security scheme name -> the recipe it declares. */
  schemeRecipes: Record<string, string>;
  /** The root-level recipe's name, when the spec declares one. */
  rootRecipe?: string;
  /** Recipe name -> the names it produces. A method only loses the names of its own recipe. */
  owned: Record<string, OwnedNames>;
  /** Lowercase names of headers any recipe produces. */
  ownedHeaders: Set<string>;
  /** Names of query parameters and body fields any recipe produces. */
  ownedParams: Set<string>;
}

function isRecipe(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.version !== undefined;
}

/** Every scheme a recipe can use: the top-level one, or each rule's. */
function recipeSchemes(recipe: any): any[] {
  return Array.isArray(recipe?.rules) && recipe.rules.length > 0 ? recipe.rules : [recipe];
}

/** Records name as produced by recipeName, in the given place. */
export function addOwnedName(info: SigningInfo, recipeName: string, where: keyof OwnedNames, name: string): void {
  const owned = ownedEntry(info, recipeName);
  if (where === 'headers') {
    owned.headers.add(name.toLowerCase());
    info.ownedHeaders.add(name.toLowerCase());
  } else {
    owned[where].add(name);
    info.ownedParams.add(name);
  }
}

function ownedEntry(info: SigningInfo, recipeName: string): OwnedNames {
  return (info.owned[recipeName] ??= { headers: new Set(), query: new Set(), body: new Set() });
}

function addOwnedNames(recipe: any, recipeName: string, info: SigningInfo): void {
  ownedEntry(info, recipeName);
  for (const scheme of recipeSchemes(recipe)) {
    for (const placement of [scheme?.inject, scheme?.set]) {
      if (!placement || typeof placement !== 'object') continue;
      for (const h of Object.keys(placement.headers || {})) addOwnedName(info, recipeName, 'headers', h);
      for (const f of placement.query || []) {
        if (f && typeof f.name === 'string') addOwnedName(info, recipeName, 'query', f.name);
      }
      for (const f of placement.body_fields || []) {
        if (f && typeof f.name === 'string') addOwnedName(info, recipeName, 'body', f.name);
      }
    }
  }
}

const NO_NAMES: OwnedNames = { headers: new Set(), query: new Set(), body: new Set() };

function ownedBy(info: SigningInfo, recipeName: string): OwnedNames {
  return info.owned[recipeName] || NO_NAMES;
}

/**
 * Collects the recipes a spec declares. schemes is the spec's security
 * schemes (OpenAPI v3 components.securitySchemes, Swagger v2
 * securityDefinitions). Returns undefined when the spec declares none.
 */
export function collectSigning(spec: any, schemes: Record<string, any> | undefined): SigningInfo | undefined {
  const info: SigningInfo = { recipes: {}, schemeRecipes: {}, owned: {}, ownedHeaders: new Set(), ownedParams: new Set() };
  for (const [name, scheme] of Object.entries<any>(schemes || {})) {
    const recipe = scheme?.[SIGNING_EXTENSION];
    if (isRecipe(recipe)) {
      info.recipes[name] = recipe;
      info.schemeRecipes[name] = name;
      addOwnedNames(recipe, name, info);
    }
  }
  const root = spec?.[SIGNING_EXTENSION] ?? spec?.info?.[SIGNING_EXTENSION];
  if (isRecipe(root)) {
    info.recipes[ROOT_RECIPE_NAME] = root;
    info.rootRecipe = ROOT_RECIPE_NAME;
    addOwnedNames(root, ROOT_RECIPE_NAME, info);
  }
  return Object.keys(info.recipes).length > 0 ? info : undefined;
}

/**
 * The recipe an operation is signed with, or undefined when it is not signed.
 * security is the operation's effective security requirement list. A recipe on
 * one of the first requirement's schemes wins; a root-level recipe applies to
 * any operation that declares security at all (a public one, with
 * `security: []`, is never signed).
 */
export function operationRecipe(security: any, info: SigningInfo | undefined): string | undefined {
  if (!info || !Array.isArray(security) || security.length === 0) return undefined;
  for (const req of security) {
    if (!req || typeof req !== 'object') continue;
    for (const schemeName of Object.keys(req)) {
      if (info.schemeRecipes[schemeName]) return info.schemeRecipes[schemeName];
    }
  }
  const declaresAny = security.some((req: any) => req && typeof req === 'object' && Object.keys(req).length > 0);
  return declaresAny ? info.rootRecipe : undefined;
}

/** SECURITY for a signed method. */
export function signedSecurity(recipeName: string): any[] {
  return [{ [recipeName]: { type: REQUEST_SIGNATURE_TYPE } }];
}

/**
 * Whether a security scheme only exists to carry part of a signature (e.g.
 * CoinSwitch's X-AUTH-APIKEY / X-AUTH-EPOCH apiKey schemes, or the scheme that
 * declares the recipe), so it must contribute no header or DEFAULTS entry.
 */
export function isSignerOwnedScheme(scheme: any, info: SigningInfo | undefined): boolean {
  if (!info || !scheme || typeof scheme !== 'object') return false;
  if (isRecipe(scheme[SIGNING_EXTENSION])) return true;
  if (String(scheme.type || '').toLowerCase() !== 'apikey' || typeof scheme.name !== 'string') return false;
  const loc = String(scheme.in || 'header').toLowerCase();
  return loc === 'header' ? info.ownedHeaders.has(scheme.name.toLowerCase()) : info.ownedParams.has(scheme.name);
}

/** Security schemes without the signer-owned ones. */
export function withoutSignerOwnedSchemes(schemes: Record<string, any> | undefined, info: SigningInfo | undefined): Record<string, any> | undefined {
  if (!info || !schemes) return schemes;
  const out: Record<string, any> = {};
  for (const [name, scheme] of Object.entries(schemes)) {
    if (!isSignerOwnedScheme(scheme, info)) out[name] = scheme;
  }
  return out;
}

/**
 * Whether a Wrekenfile INPUT (one `{name: spec}` entry) is produced by the
 * recipe. A name only counts in the place the recipe puts it, so a path
 * `timestamp` stays when the recipe injects a query `timestamp`.
 */
function isOwnedInput(name: string, def: any, owned: OwnedNames): boolean {
  const loc = String((def && typeof def === 'object' ? def.LOCATION ?? def.location : '') || '').toLowerCase();
  if (loc === 'header') return owned.headers.has(name.toLowerCase());
  if (loc === 'query') return owned.query.has(name);
  if (loc === 'body') return owned.body.has(name);
  if (loc) return false;
  return owned.headers.has(name.toLowerCase()) || owned.query.has(name) || owned.body.has(name);
}

/** INPUTS without the parameters recipeName produces. */
export function dropSignerOwnedInputs(inputs: any[], info: SigningInfo, recipeName: string): any[] {
  const owned = ownedBy(info, recipeName);
  const out: any[] = [];
  for (const entry of inputs) {
    if (!entry || typeof entry !== 'object') {
      out.push(entry);
      continue;
    }
    const kept: Record<string, any> = {};
    for (const [name, def] of Object.entries<any>(entry)) {
      if (!isOwnedInput(name, def, owned)) kept[name] = def;
    }
    if (Object.keys(kept).length > 0) out.push(kept);
  }
  return out;
}

/** HEADERS without the headers recipeName produces. */
export function dropSignerOwnedHeaders(headers: Record<string, string>, info: SigningInfo, recipeName: string): Record<string, string> {
  const owned = ownedBy(info, recipeName).headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!owned.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * Finishes a converted Wrekenfile object: drops signer-owned fields from the
 * request-body STRUCTs of signed methods (CoinDCX and Kraken document their
 * timestamp/nonce as a body field) and adds the SIGNING block.
 *
 * A body STRUCT is filtered in place only when the signed methods sending it,
 * all owning the same fields, are its only users. When anything else uses it
 * (an unsigned method, a response, another STRUCT's field) or methods signed by
 * different recipes send it, each set of signed methods gets a filtered copy,
 * so no other user loses a field.
 */
export function finishSigning(wrekenfile: any, info: SigningInfo | undefined): void {
  if (!info) return;
  wrekenfile.SIGNING = info.recipes;
  if (!wrekenfile.STRUCTS) return;
  // Signed methods sending a STRUCT body, with the body fields their recipes produce.
  const senders: { method: any; struct: string; owned: string[]; recipes: string[] }[] = [];
  for (const method of Object.values<any>(wrekenfile.METHODS || {})) {
    const struct = bodyStructName(method);
    if (!struct) continue;
    const owned = new Set<string>();
    const recipes: string[] = [];
    for (const req of Array.isArray(method?.SECURITY) ? method.SECURITY : []) {
      for (const [recipeName, s] of Object.entries<any>(req || {})) {
        if (s?.type !== REQUEST_SIGNATURE_TYPE) continue;
        recipes.push(recipeName);
        for (const f of ownedBy(info, recipeName).body) owned.add(f);
      }
    }
    const fields = wrekenfile.STRUCTS[struct];
    if (!Array.isArray(fields) || !fields.some((f: any) => f && owned.has(f.name))) continue;
    senders.push({ method, struct, owned: [...owned].sort(), recipes });
  }
  if (senders.length === 0) return;

  // Every other reference to a STRUCT: anything but the signed senders' body.
  const sending = new Set(senders.map((s) => s.method));
  const otherUses = new Set<string>();
  const collect = (v: any): void => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/STRUCT\(([^)]+)\)/g)) otherUses.add(m[1]);
    } else if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(collect);
    }
  };
  collect(wrekenfile.STRUCTS);
  for (const method of Object.values<any>(wrekenfile.METHODS || {})) {
    if (!sending.has(method)) {
      collect(method);
      continue;
    }
    const { HTTP: http, INPUTS: inputs, ...rest } = method;
    collect(rest);
    const { BODY: _body, ...httpRest } = http || {};
    collect(httpRest);
    for (const entry of Array.isArray(inputs) ? inputs : []) {
      for (const def of Object.values<any>(entry || {})) {
        if (!isBodyInput(def)) collect(def);
      }
    }
  }

  // One variant per STRUCT and set of owned fields.
  const variants = new Map<string, Map<string, typeof senders>>();
  for (const s of senders) {
    const byOwned = variants.get(s.struct) ?? new Map<string, typeof senders>();
    const key = s.owned.join(',');
    byOwned.set(key, [...(byOwned.get(key) ?? []), s]);
    variants.set(s.struct, byOwned);
  }
  for (const [struct, byOwned] of variants) {
    const fields: any[] = wrekenfile.STRUCTS[struct];
    const inPlace = byOwned.size === 1 && !otherUses.has(struct);
    for (const group of byOwned.values()) {
      const owned = new Set(group[0].owned);
      const filtered = fields.filter((f: any) => !(f && owned.has(f.name)));
      if (inPlace) {
        wrekenfile.STRUCTS[struct] = filtered;
        continue;
      }
      const recipes = [...new Set(group.flatMap((s) => s.recipes))].sort();
      const copy = uniqueStructName(wrekenfile.STRUCTS, `${struct}_${recipes.join('_').replace(/[^A-Za-z0-9_]/g, '_')}`);
      wrekenfile.STRUCTS[copy] = filtered;
      for (const s of group) pointBodyAt(s.method, struct, copy);
    }
  }
}

/** The STRUCT a method's HTTP body is, or undefined. */
function bodyStructName(method: any): string | undefined {
  return String(method?.HTTP?.BODY?.TYPE || '').match(/^STRUCT\((.+)\)$/)?.[1];
}

function isBodyInput(def: any): boolean {
  return String(def?.LOCATION ?? def?.location ?? '').toLowerCase() === 'body';
}

function uniqueStructName(structs: Record<string, any>, base: string): string {
  let name = base;
  for (let i = 2; name in structs; i++) name = `${base}_${i}`;
  return name;
}

/** Points a method's body, and its body input, at another STRUCT. */
function pointBodyAt(method: any, from: string, to: string): void {
  method.HTTP.BODY.TYPE = `STRUCT(${to})`;
  for (const entry of Array.isArray(method.INPUTS) ? method.INPUTS : []) {
    for (const def of Object.values<any>(entry || {})) {
      if (isBodyInput(def) && def.TYPE === `STRUCT(${from})`) def.TYPE = `STRUCT(${to})`;
    }
  }
}
