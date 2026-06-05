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
  /** Methods with auth headers */
  methodsWithAuth: number;
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
  const httpMethodCounts: Record<string, number> = {};

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
    if (
      normalizedHeaderKeys.includes('authorization') ||
      normalizedHeaderKeys.includes('x-api-key')
    ) {
      methodsWithAuth++;
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
    methodsWithInputs,
    warnings,
  };
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
