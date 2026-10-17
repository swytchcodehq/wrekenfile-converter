/**
 * Conversion quality metrics for Wrekenfile generation.
 * Analyzes a generated Wrekenfile object and reports statistics
 * so users understand what was converted and what was lost.
 */

export interface ConversionStats {
  /** Total number of methods/endpoints converted */
  methodCount: number;
  /** Methods with at least one RETURNS entry (non-void) */
  methodsWithReturns: number;
  /** Methods with no RETURNS (void responses) */
  methodsWithVoidReturns: number;
  /** Methods with ERRORS defined */
  methodsWithErrors: number;
  /** Total structs defined */
  structCount: number;
  /** Structs pruned by filterStructsByUsage (if tracked) */
  structsPruned: number;
  /** Methods using each HTTP method */
  httpMethodCounts: Record<string, number>;
  /** Methods with auth headers, or signed (request_signature) */
  methodsWithAuth: number;
  /** Methods signed with a SIGNING recipe (Wrekenfile 2.1.0) */
  methodsSigned: number;
  /** Methods with INPUTS */
  methodsWithInputs: number;
  /** Warnings about potential issues */
  warnings: string[];
}

/**
 * Compute conversion stats from a parsed Wrekenfile object.
 * Call this after generating the wrekenfile but before serializing to YAML.
 *
 * @param wrekenfile - The wrekenfile object (with VERSION, METHODS, STRUCTS, etc.)
 * @param preFilterStructCount - Number of structs before filterStructsByUsage (optional)
 */
export function computeConversionStats(
  wrekenfile: any,
  preFilterStructCount?: number
): ConversionStats {
  const methods = wrekenfile.METHODS || {};
  const structs = wrekenfile.STRUCTS || {};
  const warnings: string[] = [];

  let methodCount = 0;
  let methodsWithReturns = 0;
  let methodsWithVoidReturns = 0;
  let methodsWithErrors = 0;
  let methodsWithAuth = 0;
  let methodsWithInputs = 0;
  let methodsSigned = 0;
  const looksSigned: string[] = [];
  const httpMethodCounts: Record<string, number> = {};
  const hasSigning = !!wrekenfile.SIGNING && Object.keys(wrekenfile.SIGNING).length > 0;

  for (const [methodId, methodData] of Object.entries<any>(methods)) {
    methodCount++;

    // HTTP method counts
    const httpMethod = methodData.HTTP?.METHOD || 'UNKNOWN';
    httpMethodCounts[httpMethod] = (httpMethodCounts[httpMethod] || 0) + 1;

    // Returns analysis
    if (Array.isArray(methodData.RETURNS) && methodData.RETURNS.length > 0) {
      methodsWithReturns++;
    } else {
      methodsWithVoidReturns++;
      // Only warn for GET methods with no returns — that's almost always a bug
      if (httpMethod === 'GET') {
        warnings.push(`${methodId}: GET endpoint has no RETURNS`);
      }
    }

    // Errors
    if (Array.isArray(methodData.ERRORS) && methodData.ERRORS.length > 0) {
      methodsWithErrors++;
    }

    // Auth (case-insensitive header match — Wrekenfile headers can be emitted
    // in any case by user-edited files or other converters)
    const headers = methodData.HTTP?.HEADERS || {};
    const normalizedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase());
    const signed = Array.isArray(methodData.SECURITY) && methodData.SECURITY.some((req: any) =>
      Object.values<any>(req || {}).some((s) => s?.type === 'request_signature'));
    if (signed) methodsSigned++;
    if (
      signed ||
      normalizedHeaderKeys.includes('authorization') ||
      normalizedHeaderKeys.includes('x-api-key')
    ) {
      methodsWithAuth++;
    }
    // A signature, nonce or timestamp the caller would have to compute: the
    // method fails at runtime unless a signing recipe produces it.
    if (!hasSigning && signatureLikeNames(methodData).length > 0) {
      looksSigned.push(methodId);
    }

    // Inputs
    if (Array.isArray(methodData.INPUTS) && methodData.INPUTS.length > 0) {
      methodsWithInputs++;
    }
  }

  const structCount = Object.keys(structs).length;
  const structsPruned = preFilterStructCount !== undefined
    ? preFilterStructCount - structCount
    : 0;

  if (structsPruned > 0) {
    warnings.push(`${structsPruned} unused struct(s) pruned`);
  }

  if (methodCount > 0 && methodsWithReturns === 0) {
    warnings.push('No methods have response types — LLMs will not be able to parse API responses');
  }

  if (looksSigned.length > 0) {
    warnings.push(
      `${looksSigned.length} method(s) look signed (signature/nonce/timestamp header or parameter, e.g. ${looksSigned[0]}) ` +
        'but no signing recipe is declared - add an x-swytchcode-signing recipe or they will fail with 401'
    );
  }

  if (methodCount > 0 && methodsWithAuth === 0 && methodCount > 3) {
    warnings.push('No methods have authentication headers — verify if this API requires auth');
  }

  return {
    methodCount,
    methodsWithReturns,
    methodsWithVoidReturns,
    methodsWithErrors,
    structCount,
    structsPruned,
    httpMethodCounts,
    methodsWithAuth,
    methodsSigned,
    methodsWithInputs,
    warnings,
  };
}

/** Header or query names that carry a per-request signature. */
const SIGNATURE_LIKE = /^(x-[a-z0-9]+-)*(signature|sign|nonce|timestamp|recv-?window|api-?sign)$/i;

/** Header and query inputs/headers of a method whose names look like a signature. */
function signatureLikeNames(methodData: any): string[] {
  const names: string[] = [];
  for (const h of Object.keys(methodData?.HTTP?.HEADERS || {})) {
    if (SIGNATURE_LIKE.test(h)) names.push(h);
  }
  for (const entry of Array.isArray(methodData?.INPUTS) ? methodData.INPUTS : []) {
    for (const [name, def] of Object.entries<any>(entry || {})) {
      const loc = String(def?.LOCATION || '').toLowerCase();
      if ((loc === 'header' || loc === 'query') && SIGNATURE_LIKE.test(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Format conversion stats as a human-readable summary string.
 */
export function formatConversionStats(stats: ConversionStats): string {
  const lines: string[] = [];
  lines.push(`Conversion Summary:`);
  lines.push(`  Methods: ${stats.methodCount}`);

  const httpParts = Object.entries(stats.httpMethodCounts)
    .map(([method, count]) => `${method}: ${count}`)
    .join(', ');
  if (httpParts) {
    lines.push(`  HTTP methods: ${httpParts}`);
  }

  lines.push(`  With response types: ${stats.methodsWithReturns}/${stats.methodCount}`);
  if (stats.methodsWithVoidReturns > 0) {
    lines.push(`  Void (no response type): ${stats.methodsWithVoidReturns}`);
  }
  lines.push(`  With error handling: ${stats.methodsWithErrors}/${stats.methodCount}`);
  lines.push(`  With auth headers: ${stats.methodsWithAuth}/${stats.methodCount}`);
  lines.push(`  With inputs: ${stats.methodsWithInputs}/${stats.methodCount}`);
  lines.push(`  Structs: ${stats.structCount}`);
  if (stats.structsPruned > 0) {
    lines.push(`  Structs pruned (unused): ${stats.structsPruned}`);
  }

  if (stats.warnings.length > 0) {
    lines.push(`  Warnings:`);
    for (const warning of stats.warnings) {
      lines.push(`    - ${warning}`);
    }
  }

  return lines.join('\n');
}
