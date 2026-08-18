import { extractRefName, sanitizeName } from "./ref-utils";
import { RefResolver } from './ref-utils';
import { mapOpenApiType as mapType } from './type-utils';

/**
 * Shared utility for determining if a schema should be emitted/extracted as a STRUCT.
 * Fixes Bug #2 by ensuring extractMethods and extractStructs use the exact same logic.
 */


export function isStructSchema(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false;
  // If it has properties, it's definitely a struct (unless additionalProperties is the only thing, handled below)
  if (schema.properties) return true;
  // If it's a union/intersection, we emit a struct with variants
  if (schema.allOf || schema.oneOf || schema.anyOf) return true;
  // If it's explicitly type: object but has no properties, we treat it as an empty struct
  // to avoid dangling references, as long as it doesn't have additionalProperties (which makes it a map).
  if (schema.type === 'object' && !schema.additionalProperties) return true;
  // If it has no type, but has properties, it's a struct (like Zoom API)
  if (!schema.type && schema.properties) return true;
  // If it has absolutely nothing (empty schema {} like Jira API), treat as empty struct.
  if (Object.keys(schema).length === 0) return true;
  return false;
}

export function mapSchemaToMapType(ap: any, resolver: RefResolver): string {
  if (ap === true || !ap || typeof ap !== 'object') {
    return 'map[STRING]ANY';
  }
  if (ap.$ref) {
    const resolvedAp = resolver.resolveRef(ap.$ref);
    if (resolvedAp && resolvedAp.type && resolvedAp.type !== 'object') {
      if (resolvedAp.type === 'array') {
        const nestedType = getTypeFromSchema(resolvedAp, resolver);
        if (nestedType === '[]OBJECT') return `map[STRING][]STRUCT(${extractRefName(ap.$ref)}_Item)`;
        if (nestedType === 'map[STRING]OBJECT') return `map[STRING]map[STRING]STRUCT(${extractRefName(ap.$ref)}_Value)`;
        return `map[STRING]${nestedType}`;
      }
      return `map[STRING]${mapType(resolvedAp.type, resolvedAp.format)}`;
    }
    if (resolvedAp && !isStructSchema(resolvedAp)) {
      if (resolvedAp.additionalProperties) {
        return `map[STRING]${mapSchemaToMapType(resolvedAp.additionalProperties, resolver)}`;
      }
      return 'map[STRING]ANY';
    }
    return `map[STRING]STRUCT(${extractRefName(ap.$ref)})`;
  }
  if (ap.type === 'array' && ap.items) {
    if (ap.items.$ref) {
      const resolvedItems = resolver.resolveRef(ap.items.$ref);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        if (resolvedItems.type === 'array') {
          const nestedType = getTypeFromSchema(resolvedItems, resolver);
          if (nestedType === '[]OBJECT') return `map[STRING][][]STRUCT(${extractRefName(ap.items.$ref)}_Item)`;
          if (nestedType === 'map[STRING]OBJECT') return `map[STRING][]map[STRING]STRUCT(${extractRefName(ap.items.$ref)}_Value)`;
          return `map[STRING][]${nestedType}`;
        }
        return `map[STRING][]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      if (resolvedItems && !isStructSchema(resolvedItems)) {
        if (resolvedItems.additionalProperties) {
          return `map[STRING][]${mapSchemaToMapType(resolvedItems.additionalProperties, resolver)}`;
        }
        return 'map[STRING][]ANY';
      }
      return `map[STRING][]STRUCT(${extractRefName(ap.items.$ref)})`;
    }
    if (ap.items.type) {
      return `map[STRING][]${mapType(ap.items.type, ap.items.format)}`;
    }
    return 'map[STRING][]ANY';
  }
  if (ap.type) {
    return `map[STRING]${mapType(ap.type, ap.format)}`;
  }
  return 'map[STRING]ANY';
}

/**
 * Common OpenAPI idiom: `{ allOf: [{ $ref: X }], description: "..." }` wraps
 * a single $ref just to attach sibling keys (typically `description`). This
 * has the same fields as X itself, so callers should treat it exactly like a
 * direct $ref to X instead of flattening/duplicating X's fields under a
 * freshly derived struct name every time the wrapper is encountered.
 */
export function getSingleAllOfRef(schema: any): string | undefined {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.allOf) || schema.allOf.length !== 1) {
    return undefined;
  }
  const member = schema.allOf[0];
  return member && typeof member === 'object' && typeof member.$ref === 'string' ? member.$ref : undefined;
}

export function getTypeFromSchema(schema: any, resolver: RefResolver): string {
  if (!schema || typeof schema !== 'object') {
    return 'ANY';
  }
  const allOfRef = getSingleAllOfRef(schema);
  if (allOfRef) {
    return getTypeFromSchema({ $ref: allOfRef }, resolver);
  }
  if (schema.$ref) {
    const resolvedSchema = resolver.resolveRef(schema.$ref);
    if (resolvedSchema && resolvedSchema.type && resolvedSchema.type !== 'object') {
      if (resolvedSchema.type === 'array') {
        const nestedType = getTypeFromSchema(resolvedSchema, resolver);
        if (nestedType === '[]OBJECT') return `[]STRUCT(${extractRefName(schema.$ref)}_Item)`;
        if (nestedType === 'map[STRING]OBJECT') return `map[STRING]STRUCT(${extractRefName(schema.$ref)}_Value)`;
        return nestedType;
      }
      return mapType(resolvedSchema.type, resolvedSchema.format);
    }
    if (resolvedSchema && !isStructSchema(resolvedSchema)) {
      if (resolvedSchema.additionalProperties) {
        return mapSchemaToMapType(resolvedSchema.additionalProperties, resolver);
      }
      return 'ANY';
    }
    const refName = extractRefName(schema.$ref);
    return `STRUCT(${refName})`;
  }
  if (schema.type === 'array') {
    if (schema.items && schema.items.$ref) {
      const resolvedItems = resolver.resolveRef(schema.items.$ref);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        if (resolvedItems.type === 'array') {
          const nestedType = getTypeFromSchema(resolvedItems, resolver);
          if (nestedType === '[]OBJECT') return `[][]STRUCT(${extractRefName(schema.items.$ref)}_Item)`;
          if (nestedType === 'map[STRING]OBJECT') return `[]map[STRING]STRUCT(${extractRefName(schema.items.$ref)}_Value)`;
          return `[]${nestedType}`;
        }
        return `[]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      if (resolvedItems && !isStructSchema(resolvedItems)) {
        if (resolvedItems.additionalProperties) {
          return `[]${mapSchemaToMapType(resolvedItems.additionalProperties, resolver)}`;
        }
        return '[]ANY';
      }
      const refName = extractRefName(schema.items.$ref);
      return `[]STRUCT(${refName})`;
    } else if (schema.items) {
      const itemsAllOfRef = getSingleAllOfRef(schema.items);
      if (itemsAllOfRef) {
        return getTypeFromSchema({ type: 'array', items: { $ref: itemsAllOfRef } }, resolver);
      }
      if (isStructSchema(schema.items)) return '[]OBJECT';
      return `[]${mapType(schema.items.type, schema.items.format)}`;
    } else {
      return '[]ANY';
    }
  }
  
  if (isStructSchema(schema)) {
    return 'OBJECT'; // Means "this will be an inline struct"
  }
  
  if (schema.additionalProperties) {
    if (typeof schema.additionalProperties === 'object' && isStructSchema(schema.additionalProperties)) {
      return 'map[STRING]OBJECT';
    }
    const valueType = typeof schema.additionalProperties === 'object' && schema.additionalProperties.type
      ? mapType(schema.additionalProperties.type, schema.additionalProperties.format)
      : 'ANY';
    return `map[STRING]${valueType}`;
  }

  if (schema.type && schema.type !== 'object') {
    return mapType(schema.type, schema.format);
  }
  return 'ANY';
}

export function parseSchema(name: string, schema: any, resolver: RefResolver, depth = 0, visitedRefs = new Set<string>(), structs: Record<string, any[]> = {}): any[] {
  if (!schema || typeof schema !== 'object') return [];
  if (depth > 10) return [];
  if (schema.$ref) {
    if (visitedRefs.has(schema.$ref)) return [];
    visitedRefs.add(schema.$ref);
    return parseSchema(name, resolver.resolveRef(schema.$ref), resolver, depth + 1, visitedRefs, structs);
  }
  if (schema.allOf) return schema.allOf.flatMap((s: any) => parseSchema(name, s, resolver, depth + 1, visitedRefs, structs));
  
  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf || schema.anyOf;
    const fields: any[] = [];
    if (schema.discriminator?.propertyName) {
      fields.push({
        name: schema.discriminator.propertyName,
        TYPE: 'STRING',
        REQUIRED: true,
      });
    }
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (variant && typeof variant === 'object' && variant.$ref) {
        const refName = typeof variant.$ref === 'string' ? extractRefName(variant.$ref) : undefined;
        const variantType = getTypeFromSchema(variant, resolver) || 'ANY';
        fields.push({
          name: refName ? `variant_${refName}` : `variant_${i}`,
          TYPE: variantType,
          REQUIRED: false,
        });
      } else if (variant && typeof variant === 'object' && variant.type && variant.type !== 'object') {
        fields.push({
          name: `variant_${i}`,
          TYPE: mapType(variant.type, variant.format),
          REQUIRED: false,
        });
      } else {
        let variantType = getTypeFromSchema(variant, resolver) || 'ANY';
        if (variantType === 'OBJECT') {
          const subName = sanitizeName(name + '_variant_' + i);
          variantType = `STRUCT(${subName})`;
          structs[subName] = parseSchema(subName, variant, resolver, depth + 1, visitedRefs, structs);
        } else if (variantType === '[]OBJECT') {
          const subName = sanitizeName(name + '_variant_' + i + '_Item');
          variantType = `[]STRUCT(${subName})`;
          if (variant.items) structs[subName] = parseSchema(subName, variant.items, resolver, depth + 1, visitedRefs, structs);
        } else if (variantType === 'map[STRING]OBJECT') {
          const subName = sanitizeName(name + '_variant_' + i + '_Value');
          variantType = `map[STRING]STRUCT(${subName})`;
          if (variant.additionalProperties) structs[subName] = parseSchema(subName, variant.additionalProperties, resolver, depth + 1, visitedRefs, structs);
        }
        fields.push({
          name: `variant_${i}`,
          TYPE: variantType,
          REQUIRED: false,
        });
      }
    }
    return fields.length > 0 ? fields : [{
      name: 'value',
      TYPE: 'ANY',
      REQUIRED: false,
    }];
  }

  const fields: any[] = [];

  if (schema.discriminator?.propertyName) {
    fields.push({
      name: schema.discriminator.propertyName,
      TYPE: 'STRING',
      REQUIRED: true,
    });
  }

  if (schema.type && schema.type !== 'object' && !isStructSchema(schema)) {
    return [];
  }

  if (schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      let type = getTypeFromSchema(prop, resolver);
      if (type === 'OBJECT') {
        const subName = sanitizeName(name + '_' + key);
        type = `STRUCT(${subName})`;
        structs[subName] = parseSchema(subName, prop, resolver, depth + 1, visitedRefs, structs);
      }
      if (type === '[]OBJECT') {
        const subName = sanitizeName(name + '_' + key + '_Item');
        type = `[]STRUCT(${subName})`;
        if (prop.items) structs[subName] = parseSchema(subName, prop.items, resolver, depth + 1, visitedRefs, structs);
      }
      if (type === 'map[STRING]OBJECT') {
        const subName = sanitizeName(name + '_' + key + '_Value');
        type = `map[STRING]STRUCT(${subName})`;
        if (prop.additionalProperties) structs[subName] = parseSchema(subName, prop.additionalProperties, resolver, depth + 1, visitedRefs, structs);
      }
      const required = (schema.required || []).includes(key);
      const field: any = {
        name: key,
        TYPE: type,
        REQUIRED: required,
      };
      if (prop && typeof prop === 'object' && prop.description) {
        field.comment = prop.description;
      }
      fields.push(field);
    }
  }

  // If a struct is empty (like Jira empty errors), provide a dummy field 
  // so the struct is not discarded by consumers expecting fields.
  // Although Wrekenfile spec doesn't explicitly mandate fields, it's safer.
  return fields.length > 0 ? fields : [{
    name: 'value',
    TYPE: 'ANY',
    REQUIRED: false,
  }];
}

export function generateStructName(operationId: string, method: string, path: string, suffix: string): string {
  // computeCanonicalId is intentionally lossy (it's meant to collapse many
  // paths into a short, human-friendly METHOD id, with collision handling
  // applied separately by resolveCanonicalIds). Using it here for inline
  // struct names causes unrelated endpoints to collide and silently clobber
  // each other's fields in extractStructs.
  //
  // operationId is supposed to be unique per the OpenAPI spec, but
  // real-world specs sometimes reuse it across many endpoints. method+path
  // is always unique (paths/operation keys can't repeat within a spec), so
  // mix it in unconditionally rather than relying on operationId alone —
  // otherwise two endpoints sharing an operationId would still generate the
  // same inline struct name and silently clobber each other's fields, the
  // same failure mode this function was already fixed for.
  // Sanitize the same way as operationId below: path segments commonly
  // contain hyphens, colons, etc. (e.g. "/chart-data.json") that aren't
  // valid identifier characters and would otherwise leak into the name.
  const pathParts = sanitizeName(path).replace(/^_+|_+$/g, '');
  const pathId = `${method.toLowerCase()}_${pathParts}`;
  if (operationId) {
    // Sanitize: some specs use non-identifier characters in operationId
    // (e.g. "recent/newvaluefeeds"), which would otherwise leak into the
    // generated STRUCT name.
    const safeId = sanitizeName(operationId);
    return `${safeId}_${pathId}${suffix}`;
  }
  return `${pathId}${suffix}`;
}

export function getErrorStructName(rawResponse: any, op: any, code: string): string {
  if (rawResponse && rawResponse.$ref && typeof rawResponse.$ref === 'string') {
    const key = extractRefName(rawResponse.$ref) || '';
    if (/^[0-9]+$/.test(key)) {
      return `Error${key}`;
    }
    if (key) {
      return `Response_${key}`;
    }
  }
  const opId = sanitizeName(op.operationId || 'op');
  return `${opId}_Error${code}`;
}

const CONTENT_TYPE_JSON = 'application/json';

export function extractStructs(spec: any, resolver: RefResolver): Record<string, any[]> {
  const structs: Record<string, any[]> = {};
  const schemas = spec.components?.schemas || spec.definitions || {};
  
  function collectAllReferencedSchemas(schema: any, rawName: string, depth = 0) {
    const name = sanitizeName(rawName);
    if (!schema || typeof schema !== 'object' || !name || structs[name]) return;
    // Inline (non-$ref) nested objects have no stable identity to dedupe
    // by — only the generated name, which keeps growing along a cyclic
    // path (e.g. recursive expression/AST schemas) and never repeats. Cap
    // depth so such cycles can't blow the call stack; the pathological
    // leaf just won't get a struct definition beyond this point.
    if (depth > 20) return;
    const resolved = schema.$ref ? resolver.resolveRef(schema.$ref) : schema;
    
    // Parse the schema using parseSchema. We pass structs down so it can
    // recursively generate definitions for any inline objects or anyOf variants
    // it encounters, completely removing the need for manual traversal here.
    const fields = parseSchema(name, resolved, resolver, 0, new Set(), structs);

    if (isStructSchema(resolved)) {
      structs[name] = fields;
    }
  }
  
  // Extract schemas from components
  for (const name in schemas) {
    const schema = schemas[name];
    if (!schema || typeof schema !== 'object') continue;
    
    if (schema.type === 'array' && schema.items && !schema.items.$ref && isStructSchema(schema.items)) {
      const itemName = `${sanitizeName(name)}_Item`;
      collectAllReferencedSchemas(schema.items, itemName);
    } else {
      collectAllReferencedSchemas(schema, name);
    }
    
    if (schema.oneOf || schema.anyOf) {
      // Build union struct with actual variant types
      const unionName = `${sanitizeName(name)}_Union`;
      const unionFields = parseSchema(unionName, schema, resolver, 0, new Set(), structs);
      structs[unionName] = unionFields.length > 0 ? unionFields : [{ name: 'value', TYPE: 'ANY', REQUIRED: false }];
    }
  }

  // Register shared error-response schemas
  const componentResponses = spec.components?.responses || spec.responses || {};
  for (const [key, rawResp] of Object.entries<any>(componentResponses)) {
    if (!rawResp) continue;
    const jsonContent = rawResp.content?.[CONTENT_TYPE_JSON] || rawResp; // v3 vs v2
    const schema = jsonContent?.schema;
    if (!schema) continue;
    const safeKey = sanitizeName(key);
    const structName = /^[0-9]+$/.test(safeKey) ? `Error${safeKey}` : `Response_${safeKey}`;
    if (schema.$ref) {
      const refName = extractRefName(schema.$ref);
      if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
    } else if (typeof schema === 'object') {
      collectAllReferencedSchemas(schema, structName);
    }
  }
  
  // Combine paths and webhooks (OpenAPI 3.1)
  const pathLikeObjects: Array<{ pathStr: string, methods: any }> = [];
  if (spec.paths && typeof spec.paths === 'object') {
    pathLikeObjects.push(...Object.entries<any>(spec.paths).map(([k, v]) => ({ pathStr: k, methods: v })));
  }
  if (spec.webhooks && typeof spec.webhooks === 'object') {
    pathLikeObjects.push(...Object.entries<any>(spec.webhooks).map(([k, v]) => ({ pathStr: k, methods: v })));
  }

  for (const { pathStr, methods } of pathLikeObjects) {
    for (const [method, op] of Object.entries<any>(methods)) {
        if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method.toLowerCase())) continue;
        const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
        
        // Extract request body schemas (v3 and v2)
        const reqBodySchemas: any[] = [];
        let reqBody = op.requestBody;
        if (reqBody && reqBody.$ref) {
          reqBody = resolver.resolveRef(reqBody.$ref);
        }
        if (reqBody?.content) {
          for (const [_contentType, content] of Object.entries<any>(reqBody.content)) {
            if (content?.schema) reqBodySchemas.push(content.schema);
          }
        }
        const pathLevelParams = methods.parameters || [];
        const opParams = op.parameters || [];
        const allParams = [...pathLevelParams, ...opParams];
        
        if (allParams.length > 0) {
          for (let p of allParams) {
            if (p.$ref) {
              p = resolver.resolveRef(p.$ref);
            }
            if (!p) continue;
            
            if (p.in === 'body' && p.schema) {
              reqBodySchemas.push(p.schema);
            } else if (p.schema && isStructSchema(p.schema)) {
              const structName = generateStructName(operationId, method, pathStr, `Param_${p.name}`);
              collectAllReferencedSchemas(p.schema, structName);
            } else if (p.schema && p.schema.type === 'array' && p.schema.items && isStructSchema(p.schema.items)) {
              const structName = generateStructName(operationId, method, pathStr, `Param_${p.name}_Item`);
              collectAllReferencedSchemas(p.schema.items, structName);
            } else if (p.schema && p.schema.additionalProperties && typeof p.schema.additionalProperties === 'object' && isStructSchema(p.schema.additionalProperties)) {
              const structName = generateStructName(operationId, method, pathStr, `Param_${p.name}_Value`);
              collectAllReferencedSchemas(p.schema.additionalProperties, structName);
            }
          }
        }
        
        for (const schema of reqBodySchemas) {
          if (schema.$ref) {
            const refName = extractRefName(schema.$ref);
            if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
          } else if (isStructSchema(schema)) {
            const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
            collectAllReferencedSchemas(schema, requestStructName);
          } else if (schema.type === 'array' && schema.items && !schema.items.$ref && isStructSchema(schema.items)) {
            const requestStructName = generateStructName(operationId, method, pathStr, 'RequestItem');
            collectAllReferencedSchemas(schema.items, requestStructName);
          } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.additionalProperties.$ref && isStructSchema(schema.additionalProperties)) {
            const requestStructName = generateStructName(operationId, method, pathStr, 'RequestValue');
            collectAllReferencedSchemas(schema.additionalProperties, requestStructName);
          }
        }

        // Extract response schemas
        if (op.responses) {
          for (const [code, rawResp] of Object.entries<any>(op.responses)) {
            const response = rawResp?.$ref ? resolver.resolveRef(rawResp.$ref) : rawResp;
            const respSchemas: any[] = [];
            if (response && response.content) {
              for (const [_contentType, content] of Object.entries<any>(response.content)) {
                if (content?.schema) respSchemas.push(content.schema);
              }
            } else if (response && response.schema) {
              respSchemas.push(response.schema);
            }
            
            for (const schema of respSchemas) {
              if (schema.$ref) {
                const refName = extractRefName(schema.$ref);
                if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
              } else if (schema.type === 'array' && schema.items) {
                if (schema.items.$ref) {
                  const refName = extractRefName(schema.items.$ref);
                  if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.items.$ref), refName);
                } else if (isStructSchema(schema.items)) {
                  const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}Item`);
                  collectAllReferencedSchemas(schema.items, responseStructName);
                }
              } else if (isStructSchema(schema)) {
                let isError = false;
                const normalizedCode = code.toLowerCase();
                if (normalizedCode === 'default') {
                  isError = true;
                } else if (normalizedCode.endsWith('xx')) {
                  isError = parseInt(normalizedCode.charAt(0)) >= 4;
                } else {
                  isError = parseInt(code) >= 400;
                }
                
                const responseStructName = isError
                  ? getErrorStructName(rawResp, op, code)
                  : generateStructName(operationId, method, pathStr, `Response${code}`);
                collectAllReferencedSchemas(schema, responseStructName);
              } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && isStructSchema(schema.additionalProperties)) {
                let isError = false;
                const normalizedCode = code.toLowerCase();
                if (normalizedCode === 'default') {
                  isError = true;
                } else if (normalizedCode.endsWith('xx')) {
                  isError = parseInt(normalizedCode.charAt(0)) >= 4;
                } else {
                  isError = parseInt(code) >= 400;
                }
                
                if (!isError) {
                  const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}Value`);
                  collectAllReferencedSchemas(schema.additionalProperties, responseStructName);
                }
              }
            }
          }
      }
    }
  }
  
  return structs;
}
