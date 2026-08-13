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
    const resolved = resolver.resolveRef(ap.$ref);
    if (resolved && resolved.type && resolved.type !== 'object') {
      return `map[STRING]${mapType(resolved.type, resolved.format)}`;
    }
    return `map[STRING]STRUCT(${ap.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_')})`;
  }
  if (ap.type === 'array' && ap.items) {
    if (ap.items.$ref) {
      const resolvedItems = resolver.resolveRef(ap.items.$ref);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        return `map[STRING][]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      return `map[STRING][]STRUCT(${ap.items.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_')})`;
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
      return mapType(resolvedSchema.type, resolvedSchema.format);
    }
    if (resolvedSchema && !isStructSchema(resolvedSchema)) {
      if (resolvedSchema.additionalProperties) {
        return mapSchemaToMapType(resolvedSchema.additionalProperties, resolver);
      }
      return 'ANY';
    }
    const refName = schema.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
    return `STRUCT(${refName})`;
  }
  if (schema.type === 'array') {
    if (schema.items && schema.items.$ref) {
      const resolvedItems = resolver.resolveRef(schema.items.$ref);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        return `[]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      const refName = schema.items.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
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

export function parseSchema(name: string, schema: any, resolver: RefResolver, depth = 0, visitedRefs = new Set<string>()): any[] {
  if (depth > 10) return [];
  if (schema.$ref) {
    if (visitedRefs.has(schema.$ref)) return [];
    visitedRefs.add(schema.$ref);
    return parseSchema(name, resolver.resolveRef(schema.$ref), resolver, depth + 1, visitedRefs);
  }
  if (schema.allOf) return schema.allOf.flatMap((s: any) => parseSchema(name, s, resolver, depth + 1, visitedRefs));
  
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
        const refName = typeof variant.$ref === 'string' ? variant.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_') : undefined;
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
        fields.push({
          name: `variant_${i}`,
          TYPE: 'ANY',
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
      if (type === 'OBJECT') type = `STRUCT(${name}_${key})`;
      if (type === '[]OBJECT') type = `[]STRUCT(${name}_${key}_Item)`;
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
  // Wait, if it has 0 fields, let's just return [] and let extractStructs handle the empty struct creation.
  return fields;
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
  const pathParts = path.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  const pathId = `${method.toLowerCase()}_${pathParts}`;
  if (operationId) {
    // Sanitize: some specs use non-identifier characters in operationId
    // (e.g. "recent/newvaluefeeds"), which would otherwise leak into the
    // generated STRUCT name.
    const safeId = operationId.replace(/[^a-zA-Z0-9_]/g, '_');
    return `${safeId}_${pathId}${suffix}`;
  }
  return `${pathId}${suffix}`;
}

export function getErrorStructName(rawResponse: any, op: any, code: string): string {
  if (rawResponse && rawResponse.$ref && typeof rawResponse.$ref === 'string') {
    const key = rawResponse.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_') || '';
    if (/^[0-9]+$/.test(key)) {
      return `Error${key}`;
    }
    if (key) {
      return `Response_${key}`;
    }
  }
  const opId = (op.operationId || 'op').replace(/[^a-zA-Z0-9_]/g, '_');
  return `${opId}_Error${code}`;
}

const CONTENT_TYPE_JSON = 'application/json';

export function extractStructs(spec: any, resolver: RefResolver): Record<string, any[]> {
  const structs: Record<string, any[]> = {};
  const schemas = spec.components?.schemas || spec.definitions || {};
  
  // Common OpenAPI pattern: `{ allOf: [{ $ref: X }], description: "..." }`
  // wraps a $ref just to attach sibling keys. parseSchema already unwraps
  // this when computing field types (and may generate nested struct names
  // like `${name}_${key}` for X's own inline-object properties), so the
  // traversal below must resolve the same way or those generated names
  // never get registered and end up as dangling STRUCT(...) references.
  function resolveAllOfProperties(schema: any, depth = 0): Record<string, any> | undefined {
    if (!schema || typeof schema !== 'object' || depth > 5) return undefined;
    const target = schema.$ref ? resolver.resolveRef(schema.$ref) : schema;
    if (!target) return undefined;
    if (target.properties && typeof target.properties === 'object') return target.properties;
    if (Array.isArray(target.allOf)) {
      const merged: Record<string, any> = {};
      for (const member of target.allOf) {
        Object.assign(merged, resolveAllOfProperties(member, depth + 1) || {});
      }
      return Object.keys(merged).length > 0 ? merged : undefined;
    }
    return undefined;
  }

  function collectAllReferencedSchemas(schema: any, rawName: string, depth = 0) {
    const name = rawName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!schema || typeof schema !== 'object' || !name || structs[name]) return;
    // Inline (non-$ref) nested objects have no stable identity to dedupe
    // by — only the generated name, which keeps growing along a cyclic
    // path (e.g. recursive expression/AST schemas) and never repeats. Cap
    // depth so such cycles can't blow the call stack; the pathological
    // leaf just won't get a struct definition beyond this point.
    if (depth > 20) return;
    const resolved = schema.$ref ? resolver.resolveRef(schema.$ref) : schema;
    const fields = parseSchema(name, resolved, resolver);

    // Only add the struct if it's actually a struct schema!
    // Adding non-structs (like arrays or maps) generates empty structs.
    // We still traverse non-structs below (e.g. arrays) to find nested structs.
    if (isStructSchema(resolved)) {
      structs[name] = fields;
    }

    // Traverse all properties (falling back to a merged allOf when the
    // schema has no properties of its own, e.g. { allOf: [{$ref: X}] })
    const traversalProperties = resolved && isStructSchema(resolved)
      ? (resolved.properties && typeof resolved.properties === 'object' ? resolved.properties : resolveAllOfProperties(resolved))
      : undefined;
    if (traversalProperties) {
      for (const [propName, prop] of Object.entries<any>(traversalProperties)) {
        const propRef = prop && typeof prop === 'object' ? (prop.$ref || getSingleAllOfRef(prop)) : undefined;
        if (propRef) {
          const refName = propRef.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
          if (refName) collectAllReferencedSchemas(resolver.resolveRef(propRef), refName, depth + 1);
        } else if (prop && typeof prop === 'object' && prop.type === 'array' && prop.items) {
          const itemsRef = prop.items && typeof prop.items === 'object' ? (prop.items.$ref || getSingleAllOfRef(prop.items)) : undefined;
          if (itemsRef) {
            const refName = itemsRef.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
            if (refName) collectAllReferencedSchemas(resolver.resolveRef(itemsRef), refName, depth + 1);
          } else if (prop.items && typeof prop.items === 'object' && isStructSchema(prop.items)) {
            collectAllReferencedSchemas(prop.items, name + '_' + propName + '_Item', depth + 1);
          }
        } else if (prop && typeof prop === 'object' && isStructSchema(prop)) {
          collectAllReferencedSchemas(prop, name + '_' + propName, depth + 1);
        }
      }
    }
    // Traverse array items at root
    if (resolved && resolved.type === 'array' && resolved.items) {
      if (resolved.items && typeof resolved.items === 'object' && resolved.items.$ref) {
        const refName = resolved.items.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
        if (refName) collectAllReferencedSchemas(resolver.resolveRef(resolved.items.$ref), refName, depth + 1);
      } else if (resolved.items && typeof resolved.items === 'object' && isStructSchema(resolved.items)) {
        collectAllReferencedSchemas(resolved.items, name + '_Item', depth + 1);
      }
    }
    // Traverse allOf/oneOf/anyOf
    for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
      if (resolved && Array.isArray(resolved[combiner])) {
        for (const subSchema of resolved[combiner]) {
          if (subSchema && typeof subSchema === 'object' && subSchema.$ref) {
            const refName = subSchema.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
            if (refName) collectAllReferencedSchemas(resolver.resolveRef(subSchema.$ref), refName, depth + 1);
          } else if (subSchema && typeof subSchema === 'object') {
            collectAllReferencedSchemas(subSchema, name + '_' + combiner, depth + 1);
          }
        }
      }
    }
  }
  
  // Extract schemas from components
  for (const name in schemas) {
    collectAllReferencedSchemas(schemas[name], name);
    const schema = schemas[name];
    if (schema && (schema.oneOf || schema.anyOf)) {
      // Build union struct with actual variant types
      const unionFields = parseSchema(`${name}_Union`, schema, resolver);
      structs[`${name}_Union`] = unionFields.length > 0 ? unionFields : [{ name: 'value', TYPE: 'ANY', REQUIRED: false }];
    }
  }

  // Register shared error-response schemas
  const componentResponses = spec.components?.responses || spec.responses || {};
  for (const [key, rawResp] of Object.entries<any>(componentResponses)) {
    if (!rawResp) continue;
    const jsonContent = rawResp.content?.[CONTENT_TYPE_JSON] || rawResp; // v3 vs v2
    const schema = jsonContent?.schema;
    if (!schema) continue;
    const structName = /^[0-9]+$/.test(key) ? `Error${key}` : `Response_${key}`;
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
      if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
    } else if (typeof schema === 'object') {
      collectAllReferencedSchemas(schema, structName);
    }
  }
  
  // Extract inline schemas from operations
  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method.toLowerCase())) continue;
        const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
        
        // Extract request body schemas (v3 and v2)
        const reqBodySchemas: any[] = [];
        if (op.requestBody?.content) {
          for (const [_contentType, content] of Object.entries<any>(op.requestBody.content)) {
            if (content?.schema) reqBodySchemas.push(content.schema);
          }
        }
        if (op.parameters) {
          for (const p of op.parameters) {
            if (p.in === 'body' && p.schema) {
              reqBodySchemas.push(p.schema);
            }
          }
        }
        
        for (const schema of reqBodySchemas) {
          if (schema.$ref) {
            const refName = schema.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
            if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
          } else if (isStructSchema(schema)) {
            const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
            collectAllReferencedSchemas(schema, requestStructName);
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
                const refName = schema.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
                if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.$ref), refName);
              } else if (schema.type === 'array' && schema.items) {
                if (schema.items.$ref) {
                  const refName = schema.items.$ref.split('/').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
                  if (refName) collectAllReferencedSchemas(resolver.resolveRef(schema.items.$ref), refName);
                } else if (isStructSchema(schema.items)) {
                  const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}Item`);
                  collectAllReferencedSchemas(schema.items, responseStructName);
                }
              } else if (isStructSchema(schema)) {
                const statusCode = parseInt(code);
                const responseStructName = statusCode >= 400
                  ? getErrorStructName(rawResp, op, code)
                  : generateStructName(operationId, method, pathStr, `Response${code}`);
                collectAllReferencedSchemas(schema, responseStructName);
              }
            }
          }
        }
      }
    }
  }
  
  return structs;
}
