/**
 * Utilities for working with STRUCTS in generated Wrekenfiles.
 * - Filters out unused structs (no STRUCT(...) reference anywhere)
 */

/**
 * Extract all struct names from a type string, e.g.:
 * - "STRUCT(User)" -> ["User"]
 * - "[]STRUCT(model.User)" -> ["model.User"]
 * - "map[string]STRUCT(api.Request)" -> ["api.Request"]
 */
export function extractAllStructNames(typeString: string): string[] {
  const names: string[] = [];
  const structPattern = /STRUCT\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = structPattern.exec(typeString)) !== null) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

/**
 * Filter STRUCTS map on a Wrekenfile object to only keep structs that are actually used.
 * Usage is any occurrence of STRUCT(Name) in:
 * - METHOD.INPUTS / RETURNS / ERRORS
 * - HTTP.BODY.TYPE
 * - ASYNC.RESULT.TYPE
 * plus transitive references inside other structs.
 */
export function filterStructsByUsage(wrekenfile: any): void {
  if (!wrekenfile || !wrekenfile.STRUCTS) return;
  const structs: Record<string, any[]> = wrekenfile.STRUCTS;

  const used = new Set<string>();

  const addFromType = (typeVal: any) => {
    if (!typeVal || typeof typeVal !== 'string') return;
    for (const name of extractAllStructNames(typeVal)) {
      if (name) used.add(name);
    }
  };

  // Collect from METHODS
  const methods = wrekenfile.METHODS || {};
  for (const methodData of Object.values<any>(methods)) {
    // INPUTS
    if (Array.isArray(methodData.INPUTS)) {
      for (const input of methodData.INPUTS) {
        for (const value of Object.values<any>(input)) {
          if (typeof value === 'string') {
            addFromType(value);
          } else if (value && typeof value === 'object') {
            addFromType(value.TYPE);
          }
        }
      }
    }
    // RETURNS
    if (Array.isArray(methodData.RETURNS)) {
      for (const ret of methodData.RETURNS) {
        addFromType(ret.RETURNTYPE);
      }
    }
    // ERRORS
    if (Array.isArray(methodData.ERRORS)) {
      for (const err of methodData.ERRORS) {
        addFromType(err.TYPE);
      }
    }
    // HTTP.BODY.TYPE
    if (methodData.HTTP && methodData.HTTP.BODY) {
      addFromType(methodData.HTTP.BODY.TYPE);
    }
    // ASYNC.RESULT.TYPE
    if (methodData.ASYNC && methodData.ASYNC.RESULT) {
      addFromType(methodData.ASYNC.RESULT.TYPE);
    }
  }

  // Transitive closure: structs referenced from other structs
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fields] of Object.entries<any[]>(structs)) {
      if (!used.has(name)) continue;
      for (const field of fields || []) {
        const t = (field && field.TYPE) as string | undefined;
        if (!t) continue;
        for (const nested of extractAllStructNames(t)) {
          if (nested && !used.has(nested)) {
            used.add(nested);
            changed = true;
          }
        }
      }
    }
  }

  // Rebuild STRUCTS with only used entries
  for (const name of Object.keys(structs)) {
    if (!used.has(name)) {
      delete structs[name];
    }
  }

  // Second pass: Replace any remaining dangling refs in methods with ANY
  const replaceDangling = (typeStr: any): any => {
    if (!typeStr || typeof typeStr !== 'string') return typeStr;
    const referenced = extractAllStructNames(typeStr);
    for (const ref of referenced) {
      if (ref && !structs[ref]) {
        return 'ANY';
      }
    }
    return typeStr;
  };

  if (wrekenfile.METHODS) {
    for (const methodData of Object.values<any>(wrekenfile.METHODS)) {
      if (Array.isArray(methodData.INPUTS)) {
        for (const input of methodData.INPUTS) {
          if (input && typeof input === 'object') {
            const key = Object.keys(input)[0];
            if (key && input[key].TYPE) {
              input[key].TYPE = replaceDangling(input[key].TYPE);
            }
          }
        }
      }
      if (Array.isArray(methodData.RETURNS)) {
        for (const ret of methodData.RETURNS) {
          if (ret.TYPE) ret.TYPE = replaceDangling(ret.TYPE);
        }
      }
      if (Array.isArray(methodData.ERRORS)) {
        for (const err of methodData.ERRORS) {
          if (err.TYPE) err.TYPE = replaceDangling(err.TYPE);
        }
      }
    }
  }

  for (const fields of Object.values<any[]>(structs)) {
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (field.TYPE) {
          field.TYPE = replaceDangling(field.TYPE);
        }
      }
    }
  }

  wrekenfile.STRUCTS = structs;
}
