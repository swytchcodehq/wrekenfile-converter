// openapi-to-wrekenfile-v2.ts
// Converts OpenAPI v3 specifications to Wrekenfile v2.0.1 format
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { generateYamlString } from './utils/yaml-utils';
import { 
  WREKENFILE_VERSION,
  DEFAULT_BASE_URL,
  EXECUTION_MODE_SYNC,
  TYPE_ANY,
  BODYTYPE_RAW,
  CONTENT_TYPE_JSON,
  CONTENT_TYPE_FORM_DATA,
  CONTENT_TYPE_URLENCODED,
  HEADER_CONTENT_TYPE,
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
  HTTP_METHODS_WITH_BODY,
} from './utils/constants';
import { generateReturnVarName, generateErrorWhen } from './utils/response-utils';
import { mapOpenApiType } from './utils/type-utils';
import { generateOpenApiSummary } from './utils/summary-utils';
import { validateOpenApiV3Spec, validateBaseDir, logError, createConverterError } from './utils/error-utils';
import { resolveCanonicalIds, computeCanonicalId, type MethodCanonicalInput } from './utils/canonical-id';
import { filterStructsByUsage } from './utils/struct-utils';
import { computeConversionStats, type ConversionStats } from './utils/conversion-stats';

const externalRefCache: Record<string, any> = {};

// Re-export for backward compatibility
const mapType = mapOpenApiType;
const generateSummary = generateOpenApiSummary;

function resolveRef(ref: string, spec: any, baseDir: string): any {
  if (!ref || typeof ref !== 'string') {
    throw createConverterError(
      `Invalid $ref: must be a non-empty string`,
      "INVALID_REF",
      { ref, refType: typeof ref }
    );
  }

  if (ref.startsWith('#/')) {
    const pathParts = ref.split('/').slice(1);
    let result = spec;
    for (const part of pathParts) {
      if (result === undefined || result === null) {
        throw createConverterError(
          `Failed to resolve $ref: ${ref} - path segment '${part}' not found`,
          "REF_RESOLUTION_FAILED",
          { ref, pathParts, currentPath: pathParts.slice(0, pathParts.indexOf(part) + 1) }
        );
      }
      result = result[part];
    }
    return result;
  }

  const [filePath, internal] = ref.split('#');
  if (!filePath) {
    throw createConverterError(
      `Invalid external $ref: missing file path in ${ref}`,
      "INVALID_EXTERNAL_REF",
      { ref }
    );
  }

  const fullPath = path.resolve(baseDir, filePath);
  if (!fs.existsSync(fullPath)) {
    throw createConverterError(
      `External $ref file not found: ${fullPath}`,
      "EXTERNAL_REF_FILE_NOT_FOUND",
      { ref, filePath, baseDir, fullPath }
    );
  }

  try {
    if (!externalRefCache[fullPath]) {
      const content = fs.readFileSync(fullPath, 'utf8');
      externalRefCache[fullPath] = load(content);
    }
    
    if (internal) {
      const internalPath = internal.split('/').slice(1);
      let result = externalRefCache[fullPath];
      for (const part of internalPath) {
        if (result === undefined || result === null) {
          throw createConverterError(
            `Failed to resolve internal $ref: ${internal} in file ${fullPath}`,
            "INTERNAL_REF_RESOLUTION_FAILED",
            { ref, internal, filePath, internalPath }
          );
        }
        result = result[part];
      }
      return result;
    }
    return externalRefCache[fullPath];
  } catch (err: any) {
    if (err.code && err.code.startsWith('REF_')) {
      throw err;
    }
    throw createConverterError(
      `Error loading external $ref file: ${fullPath}`,
      "EXTERNAL_REF_LOAD_ERROR",
      { ref, filePath, fullPath },
      err
    );
  }
}

/**
 * Build a Wrekenfile map value-type string from an `additionalProperties` value.
 * Handles scalar, array-of-scalar, array-of-ref, and ref value types so we can
 * render `map[STRING]X` for objects defined only by `additionalProperties`.
 */
function mapSchemaToMapType(ap: any, spec: any, baseDir: string): string {
  if (ap === true || !ap || typeof ap !== 'object') {
    return 'map[STRING]ANY';
  }
  if (ap.$ref) {
    const resolved = resolveRef(ap.$ref, spec, baseDir);
    if (resolved && resolved.type && resolved.type !== 'object') {
      return `map[STRING]${mapType(resolved.type, resolved.format)}`;
    }
    return `map[STRING]STRUCT(${ap.$ref.split('/').pop()})`;
  }
  if (ap.type === 'array' && ap.items) {
    if (ap.items.$ref) {
      const resolvedItems = resolveRef(ap.items.$ref, spec, baseDir);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        return `map[STRING][]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      return `map[STRING][]STRUCT(${ap.items.$ref.split('/').pop()})`;
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

function getTypeFromSchema(schema: any, spec: any, baseDir: string): string {
  if (!schema || typeof schema !== 'object') {
    return 'ANY';
  }
  if (schema.$ref) {
    const resolvedSchema = resolveRef(schema.$ref, spec, baseDir);
    if (resolvedSchema && resolvedSchema.type && resolvedSchema.type !== 'object') {
      return mapType(resolvedSchema.type, resolvedSchema.format);
    }
    // Resolve propertyless object schemas at the $ref site so we don't emit
    // dangling STRUCT(Foo) references for schemas that will never be registered
    // (since they have no properties to parse into struct fields).
    if (resolvedSchema && resolvedSchema.type === 'object' && !resolvedSchema.properties) {
      if (resolvedSchema.additionalProperties) {
        return mapSchemaToMapType(resolvedSchema.additionalProperties, spec, baseDir);
      }
      return 'OBJECT';
    }
    const refName = schema.$ref.split('/').pop();
    return `STRUCT(${refName})`;
  }
  if (schema.type === 'array') {
    if (schema.items && schema.items.$ref) {
      const resolvedItems = resolveRef(schema.items.$ref, spec, baseDir);
      if (resolvedItems && resolvedItems.type && resolvedItems.type !== 'object') {
        return `[]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      const refName = schema.items.$ref.split('/').pop();
      return `[]STRUCT(${refName})`;
    } else if (schema.items) {
      return `[]${mapType(schema.items.type, schema.items.format)}`;
    } else {
      return '[]ANY';
    }
  }
  if (schema.type === 'object') {
    // Check if it has properties or is a generic object
    if (schema.properties || schema.additionalProperties) {
      // If it has additionalProperties, it's a map
      if (schema.additionalProperties) {
        const valueType = typeof schema.additionalProperties === 'object' && schema.additionalProperties.type
          ? mapType(schema.additionalProperties.type, schema.additionalProperties.format)
          : 'ANY';
        return `map[STRING]${valueType}`;
      }
      // Otherwise it's a struct (will be defined in STRUCTS)
      return 'OBJECT';
    }
    // Generic object without properties
    return 'OBJECT';
  }
  if (schema.type && schema.type !== 'object') {
    return mapType(schema.type, schema.format);
  }
  return 'ANY';
}

function parseSchema(name: string, schema: any, spec: any, baseDir: string, depth = 0): any[] {
  if (depth > 3) return [];
  if (schema.$ref) return parseSchema(name, resolveRef(schema.$ref, spec, baseDir), spec, baseDir, depth + 1);
  if (schema.allOf) return schema.allOf.flatMap((s: any) => parseSchema(name, s, spec, baseDir, depth + 1));
  if (schema.oneOf || schema.anyOf) {
    // Enumerate union variants with their actual types
    const variants = schema.oneOf || schema.anyOf;
    const fields: any[] = [];
    // Add discriminator field if present
    if (schema.discriminator?.propertyName) {
      fields.push({
        name: schema.discriminator.propertyName,
        type: 'STRING',
        REQUIRED: true,
      });
    }
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      if (variant && typeof variant === 'object' && variant.$ref) {
        const refName = typeof variant.$ref === 'string' ? variant.$ref.split('/').pop() : undefined;
        const variantType = getTypeFromSchema(variant, spec, baseDir) || 'ANY';
        fields.push({
          name: refName ? `variant_${refName}` : `variant_${i}`,
          type: variantType,
          REQUIRED: false,
        });
      } else if (variant && typeof variant === 'object' && variant.type && variant.type !== 'object') {
        fields.push({
          name: `variant_${i}`,
          type: mapType(variant.type, variant.format),
          REQUIRED: false,
        });
      } else {
        fields.push({
          name: `variant_${i}`,
          type: 'ANY',
          REQUIRED: false,
        });
      }
    }
    return fields.length > 0 ? fields : [{
      name: 'value',
      type: 'ANY',
      REQUIRED: false,
    }];
  }

  const fields: any[] = [];

  if (schema.discriminator?.propertyName) {
    fields.push({
      name: schema.discriminator.propertyName,
      type: 'STRING',
      REQUIRED: true,
    });
  }

  // Handle simple types (string, integer, etc.) - these should not create structs
  if (schema.type && schema.type !== 'object') {
    return [];
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      const type = getTypeFromSchema(prop, spec, baseDir);
      
      // Use the required field from the OpenAPI spec
      const required = (schema.required || []).includes(key);
      
      const field: any = {
        name: key,
        type,
        REQUIRED: required,
      };

      // Add comment if description exists
      if (prop && typeof prop === 'object' && prop.description) {
        field.comment = prop.description;
      }
      
      fields.push(field);
    }
  }

  return fields;
}

function generateStructName(_operationId: string, method: string, path: string, suffix: string): string {
  // Use canonical ID as the base for inline request/response struct names
  const canonicalId = computeCanonicalId('api', method.toUpperCase(), path);
  return `${canonicalId}${suffix}`;
}

/**
 * Pick a struct name for an error response whose content schema is inline
 * (no `$ref`). When the response object itself is a `$ref` to
 * `#/components/responses/X`, the returned name is stable across all call
 * sites so the struct can be defined once and referenced from every operation.
 */
function getErrorStructName(rawResponse: any, op: any, code: string): string {
  if (rawResponse && rawResponse.$ref && typeof rawResponse.$ref === 'string') {
    const key = rawResponse.$ref.split('/').pop() || '';
    if (/^[0-9]+$/.test(key)) {
      return `Error${key}`;
    }
    if (key) {
      return `Response_${key}`;
    }
  }
  // Truly inline per-operation error schema — scope the name to the operation
  const opId = op.operationId || 'op';
  return `${opId}_Error${code}`;
}

function extractStructs(spec: any, baseDir: string): Record<string, any[]> {
  const structs: Record<string, any[]> = {};
  const schemas = spec.components?.schemas || {};
  
  // Helper to recursively collect all referenced schemas
  function collectAllReferencedSchemas(schema: any, name: string) {
    if (!schema || typeof schema !== 'object' || !name || structs[name]) return;
    const resolved = schema.$ref ? resolveRef(schema.$ref, spec, baseDir) : schema;
    const fields = parseSchema(name, resolved, spec, baseDir);
    
    // Only add struct if it has at least one field
    if (fields.length > 0) {
      structs[name] = fields;
    }

    // Traverse all properties
    if (resolved && resolved.type === 'object' && resolved.properties && typeof resolved.properties === 'object') {
      for (const [propName, prop] of Object.entries<any>(resolved.properties)) {
        if (prop && typeof prop === 'object' && prop.$ref) {
          const refName = prop.$ref.split('/').pop();
          if (refName) collectAllReferencedSchemas(resolveRef(prop.$ref, spec, baseDir), refName);
        } else if (prop && typeof prop === 'object' && prop.type === 'array' && prop.items) {
          if (prop.items && typeof prop.items === 'object' && prop.items.$ref) {
            const refName = prop.items.$ref.split('/').pop();
            if (refName) collectAllReferencedSchemas(resolveRef(prop.items.$ref, spec, baseDir), refName);
          } else if (prop.items && typeof prop.items === 'object' && (prop.items.type === 'object' || prop.items.properties || prop.items.allOf || prop.items.oneOf || prop.items.anyOf)) {
            collectAllReferencedSchemas(prop.items, name + '_' + propName + '_Item');
          }
        } else if (prop && typeof prop === 'object' && (prop.type === 'object' || prop.properties || prop.allOf || prop.oneOf || prop.anyOf)) {
          collectAllReferencedSchemas(prop, name + '_' + propName);
        }
      }
    }
    // Traverse array items at root
    if (resolved && resolved.type === 'array' && resolved.items) {
      if (resolved.items && typeof resolved.items === 'object' && resolved.items.$ref) {
        const refName = resolved.items.$ref.split('/').pop();
        if (refName) collectAllReferencedSchemas(resolveRef(resolved.items.$ref, spec, baseDir), refName);
      } else if (resolved.items && typeof resolved.items === 'object' && (resolved.items.type === 'object' || resolved.items.properties || resolved.items.allOf || resolved.items.oneOf || resolved.items.anyOf)) {
        collectAllReferencedSchemas(resolved.items, name + '_Item');
      }
    }
    // Traverse allOf/oneOf/anyOf
    for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
      if (resolved && Array.isArray(resolved[combiner])) {
        for (const subSchema of resolved[combiner]) {
          if (subSchema && typeof subSchema === 'object' && subSchema.$ref) {
            const refName = subSchema.$ref.split('/').pop();
            if (refName) collectAllReferencedSchemas(resolveRef(subSchema.$ref, spec, baseDir), refName);
          } else if (subSchema && typeof subSchema === 'object') {
            collectAllReferencedSchemas(subSchema, name + '_' + combiner);
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
      const unionFields = parseSchema(`${name}_Union`, schema, spec, baseDir);
      structs[`${name}_Union`] = unionFields.length > 0 ? unionFields : [{ name: 'value', type: 'ANY', REQUIRED: false }];
    }
  }

  // Register shared error-response schemas from components.responses under the
  // same name extractErrors uses for them, so `STRUCT(ErrorNNN)` references
  // resolve to an actual definition.
  const componentResponses = spec.components?.responses || {};
  for (const [key, rawResp] of Object.entries<any>(componentResponses)) {
    if (!rawResp || !rawResp.content) continue;
    const jsonContent = rawResp.content[CONTENT_TYPE_JSON];
    const schema = jsonContent?.schema;
    if (!schema) continue;
    const structName = /^[0-9]+$/.test(key) ? `Error${key}` : `Response_${key}`;
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop();
      if (refName) collectAllReferencedSchemas(resolveRef(schema.$ref, spec, baseDir), refName);
    } else if (typeof schema === 'object') {
      collectAllReferencedSchemas(schema, structName);
    }
  }
  
  // Extract inline schemas from operations
  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
        // Extract request body schemas
        if (op.requestBody?.content) {
          for (const [_contentType, content] of Object.entries<any>(op.requestBody.content)) {
            if (content && content.schema) {
              if (content.schema && content.schema.$ref) {
                const refName = content.schema.$ref.split('/').pop();
                if (refName) collectAllReferencedSchemas(resolveRef(content.schema.$ref, spec, baseDir), refName);
              } else if (content.schema && typeof content.schema === 'object') {
                const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
                collectAllReferencedSchemas(content.schema, requestStructName);
              }
            }
          }
        }
        // Extract response schemas
        if (op.responses) {
          for (const [code, rawResp] of Object.entries<any>(op.responses)) {
            // Resolve $ref on the response object itself (e.g. $ref: '#/components/responses/...')
            const response = rawResp?.$ref ? resolveRef(rawResp.$ref, spec, baseDir) : rawResp;
            if (response && response.content) {
              for (const [_contentType, content] of Object.entries<any>(response.content)) {
                if (content && content.schema) {
                  const schema = content.schema;
                  if (schema.$ref) {
                    const refName = schema.$ref.split('/').pop();
                    if (refName) collectAllReferencedSchemas(resolveRef(schema.$ref, spec, baseDir), refName);
                  } else if (schema.type === 'array' && schema.items) {
                    // For array responses, extract the item type
                    if (schema.items.$ref) {
                      const refName = schema.items.$ref.split('/').pop();
                      if (refName) collectAllReferencedSchemas(resolveRef(schema.items.$ref, spec, baseDir), refName);
                    } else if (schema.items.type === 'object') {
                      // Inline object in array - create struct for the item
                      const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}Item`);
                      collectAllReferencedSchemas(schema.items, responseStructName);
                    }
                  } else if (schema.type === 'object' && typeof schema === 'object') {
                    // Inline object schema - create struct. Error codes use
                    // the same naming extractErrors picks so the STRUCT(...)
                    // reference resolves to this definition.
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
    }
  }
  
  return structs;
}

function getContentTypeAndBodyType(op: any): { contentType: string; bodyType: string } {
  const requestBody = op.requestBody;
  if (!requestBody?.content) {
    return { contentType: CONTENT_TYPE_JSON, bodyType: BODYTYPE_RAW };
  }

  const contentTypes = Object.keys(requestBody.content);
  const contentType = contentTypes[0] || CONTENT_TYPE_JSON;
  
  let bodyType = BODYTYPE_RAW;
  if (contentType === CONTENT_TYPE_FORM_DATA) {
    bodyType = 'form-data';
  } else if (contentType === CONTENT_TYPE_URLENCODED) {
    bodyType = 'x-www-form-urlencoded';
  }

  return { contentType, bodyType };
}

function getAcceptContentType(op: any): string {
  // Get the first content type from the first success response (2xx)
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    if (statusCode >= 200 && statusCode < 300 && response.content) {
      const contentTypes = Object.keys(response.content);
      if (contentTypes.length > 0) {
        return contentTypes[0];
      }
    }
  }
  // Default to JSON if no response content type found
  return CONTENT_TYPE_JSON;
}

function getHeadersForOperation(op: any, spec: any, method?: string, baseDir?: string): Record<string, string> {
  const { contentType } = getContentTypeAndBodyType(op);
  
  // Use a Map to prevent duplicate headers
  const headerMap = new Map<string, string>();
  
  // Add Content-Type header for POST/PUT/PATCH requests
  const httpMethod = method?.toLowerCase() || op.method?.toLowerCase() || '';
  if (HTTP_METHODS_WITH_BODY.includes(httpMethod)) {
    headerMap.set(HEADER_CONTENT_TYPE, contentType);
  }
  
  // Add security headers based on the operation's security requirements
  const security = op.security || spec.security || [];
  
  for (const securityRequirement of security) {
    for (const [schemeName, _scopes] of Object.entries(securityRequirement)) {
      const scheme = spec.components?.securitySchemes?.[schemeName];
      if (scheme) {
        if (scheme.type === 'http') {
          if (scheme.scheme === 'bearer') {
            headerMap.set(HEADER_AUTHORIZATION, AUTH_BEARER_TOKEN);
          } else if (scheme.scheme === 'basic') {
            headerMap.set(HEADER_AUTHORIZATION, AUTH_BASIC_AUTH);
          } else if (scheme.scheme === 'digest') {
            headerMap.set(HEADER_AUTHORIZATION, AUTH_DIGEST_AUTH);
          } else {
            headerMap.set(HEADER_AUTHORIZATION, `<${scheme.scheme}_auth>`);
          }
        } else if (scheme.type === 'apiKey') {
          if (scheme.in === 'header') {
            headerMap.set(scheme.name, scheme.name.toLowerCase());
          }
        } else if (scheme.type === 'oauth2') {
          headerMap.set(HEADER_AUTHORIZATION, AUTH_BEARER_TOKEN);
        } else if (scheme.type === 'openIdConnect') {
          headerMap.set(HEADER_AUTHORIZATION, AUTH_ID_TOKEN);
        }
      }
    }
  }
  
  // Check if Authorization is used as a parameter but not defined in securitySchemes
  if (op.parameters) {
    for (let param of op.parameters) {
      // Resolve $ref if present
      if (param && typeof param === 'object' && param.$ref) {
        param = resolveRef(param.$ref, spec, baseDir || '');
      }
      if (param && typeof param === 'object' && param.in === 'header' && param.name === HEADER_AUTHORIZATION && !headerMap.has(HEADER_AUTHORIZATION)) {
        headerMap.set(HEADER_AUTHORIZATION, AUTH_BEARER_TOKEN);
      }
    }
  }
  
  // Convert Map to object
  const headers: Record<string, string> = {};
  for (const [key, value] of headerMap.entries()) {
    headers[key] = value;
  }
  
  return headers;
}

function extractParameters(op: any, spec: any, baseDir: string): any[] {
  const inputParams: any[] = [];
  
  // v2.0.2: All parameters (path, query, header) must be in INPUTS with LOCATION
  // Path parameters are also in ENDPOINT (e.g., /tasks/{taskId})
  // Header parameters are also in HTTP.HEADERS
  // Body parameters are handled separately in extractRequestBody
  for (let param of op.parameters || []) {
    // Resolve $ref if present
    if (param.$ref) {
      param = resolveRef(param.$ref, spec, baseDir);
    }

    const paramIn = param.in || 'query';
    
    // Skip body parameters - they're handled in extractRequestBody
    if (paramIn === 'body' || paramIn === 'formData') {
      continue;
    }

    const paramName = param.name;
    const paramSchema = param.schema || {};
    
    let type = 'STRING';
    if (paramSchema.type) {
      type = getTypeFromSchema(paramSchema, spec, baseDir);
    } else if (paramSchema.$ref) {
      type = getTypeFromSchema(paramSchema, spec, baseDir);
    }
    
    const isRequired = param.required === true;
    const hasDefault = paramSchema.default !== undefined;
    
    // v2.0.2: All INPUTS must have LOCATION field
    // Build input parameter with LOCATION
    if (isRequired && !hasDefault) {
      // Simple form: - paramName: TYPE (but we need LOCATION, so use extended form)
      const inputParam: any = {};
      inputParam[paramName] = {
        TYPE: type,
        LOCATION: paramIn,
      };
      inputParams.push(inputParam);
    } else {
      // Extended form: - paramName: { TYPE: ..., REQUIRED: ..., DEFAULT: ..., LOCATION: ... }
      const inputParam: any = {};
      inputParam[paramName] = {
        TYPE: type,
        REQUIRED: isRequired,
        LOCATION: paramIn,
      };
      if (hasDefault) {
        inputParam[paramName].DEFAULT = paramSchema.default;
      }
      inputParams.push(inputParam);
    }
  }
  
  return inputParams;
}

function extractRequestBody(op: any, operationId: string, method: string, path: string, spec: any, baseDir: string): any[] {
  const inputParams: any[] = [];
  const requestBody = op.requestBody;
  if (!requestBody?.content) {
    return inputParams;
  }
  const contentTypes = Object.keys(requestBody.content);
  const contentType = contentTypes[0];
  if (contentType === CONTENT_TYPE_JSON && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    let type: string;
    if (bodySchema && bodySchema.$ref) {
      type = getTypeFromSchema(bodySchema, spec, baseDir);
    } else if (bodySchema) {
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    } else {
      type = 'ANY';
    }
    
    const isRequired = requestBody.required === true;
    // v2.0.2: All INPUTS must have LOCATION field
    if (isRequired) {
      // Simple form with LOCATION
      const inputParam: any = {};
      inputParam.body = {
        TYPE: type,
        LOCATION: 'body',
      };
      inputParams.push(inputParam);
    } else {
      // Extended form with LOCATION
      const inputParam: any = {};
      inputParam.body = {
        TYPE: type,
        REQUIRED: false,
        LOCATION: 'body',
      };
      inputParams.push(inputParam);
    }
  } else if (contentType === 'multipart/form-data' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    if (bodySchema && bodySchema.properties) {
      for (const [key, prop] of Object.entries<any>(bodySchema.properties)) {
        const type = prop && prop.format === 'binary' ? 'STRING' : getTypeFromSchema(prop, spec, baseDir);
        const required = (bodySchema.required || []).includes(key);
        const hasDefault = prop && prop.default !== undefined;
        
        const inputParam: any = {};
        // v2.0.2: All INPUTS must have LOCATION field
        if (required && !hasDefault) {
          // Simple form with LOCATION
          inputParam[key] = {
            TYPE: type,
            LOCATION: 'body',
          };
        } else {
          // Extended form with LOCATION
          inputParam[key] = {
            TYPE: type,
            REQUIRED: required,
            LOCATION: 'body',
          };
          if (hasDefault) {
            inputParam[key].DEFAULT = prop.default;
          }
        }
        inputParams.push(inputParam);
      }
    }
  } else if (contentType === 'application/x-www-form-urlencoded' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    if (bodySchema && bodySchema.properties) {
      for (const [key, prop] of Object.entries<any>(bodySchema.properties)) {
        const type = getTypeFromSchema(prop, spec, baseDir);
        const required = (bodySchema.required || []).includes(key);
        const hasDefault = prop && prop.default !== undefined;
        
        const inputParam: any = {};
        // v2.0.2: All INPUTS must have LOCATION field
        if (required && !hasDefault) {
          // Simple form with LOCATION
          inputParam[key] = {
            TYPE: type,
            LOCATION: 'body',
          };
        } else {
          // Extended form with LOCATION
          inputParam[key] = {
            TYPE: type,
            REQUIRED: required,
            LOCATION: 'body',
          };
          if (hasDefault) {
            inputParam[key].DEFAULT = prop.default;
          }
        }
        inputParams.push(inputParam);
      }
    }
  }
  return inputParams;
}

function extractResponses(op: any, operationId: string, method: string, path: string, spec: any, baseDir: string): any[] {
  const returns: any[] = [];

  // Only include success responses (2xx) in RETURNS section
  // Error responses go in ERRORS section
  for (const [code, rawResponse] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);

    // Only process 2xx success responses
    if (statusCode < 200 || statusCode >= 300) {
      continue;
    }

    // Resolve $ref on the response object itself (e.g. $ref: '#/components/responses/...')
    const response = rawResponse.$ref ? resolveRef(rawResponse.$ref, spec, baseDir) : rawResponse;

    const content = response.content;
    let returnType: string | null = null;

    // 204 No Content - no response body
    if (code === '204') {
      // Skip void responses - they should not have RETURNS section
      continue;
    }

    if (content) {
      const jsonContent = content[CONTENT_TYPE_JSON];
      if (jsonContent?.schema) {
        const schema = jsonContent.schema;
        // Use getTypeFromSchema to handle arrays, $refs, and inline schemas correctly
          returnType = getTypeFromSchema(schema, spec, baseDir);
        
        // If it's an inline object schema (not array, not $ref), we need to create a struct
        if (returnType === 'OBJECT' && !schema.$ref && schema.type === 'object') {
          const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
          returnType = `STRUCT(${responseStructName})`;
        }
      } else {
        // No schema but has content - might be empty body
        returnType = 'ANY';
      }
    } else {
      // No content - skip void success responses
      continue;
    }

    // Only add to RETURNS if there's actually a return type
    if (returnType) {
      // Generate descriptive RETURNVAR name based on response code and operation
      const operationName = operationId || method.toLowerCase() + path.replace(/[\/{}]/g, '_');
      const returnVarName = generateReturnVarName(operationName, code);

      // v2.0.2: STATUS code is required in RETURNS
      const returnItem: any = {
        RETURNTYPE: returnType,
        RETURNVAR: returnVarName,
        STATUS: statusCode,
      };

      // Check for pagination hints in response schema
      if (content) {
        const jsonContent = content[CONTENT_TYPE_JSON];
        if (jsonContent?.schema) {
          const schema = jsonContent.schema;
          const resolvedSchema = schema.$ref ? resolveRef(schema.$ref, spec, baseDir) : schema;
          if (resolvedSchema && resolvedSchema.properties) {
            // Look for common pagination fields
            if (resolvedSchema.properties.next_cursor || resolvedSchema.properties.cursor) {
              returnItem.PAGINATION = {
                TYPE: 'cursor',
                CURSOR_FIELD: resolvedSchema.properties.next_cursor ? 'next_cursor' : 'cursor',
              };
            } else if (resolvedSchema.properties.offset !== undefined || resolvedSchema.properties.skip !== undefined) {
              returnItem.PAGINATION = {
                TYPE: 'offset',
                OFFSET_FIELD: resolvedSchema.properties.offset !== undefined ? 'offset' : 'skip',
              };
            } else if (resolvedSchema.properties.page !== undefined || resolvedSchema.properties.pageNumber !== undefined) {
              returnItem.PAGINATION = {
                TYPE: 'page',
                PAGE_SIZE_FIELD: (resolvedSchema.properties.pageSize !== undefined && resolvedSchema.properties.pageSize !== null) 
                  ? String(resolvedSchema.properties.pageSize) 
                  : 'limit',
              };
            }
          }
        }
      }

      returns.push(returnItem);
    }
  }

  return returns;
}

function extractErrors(op: any, spec: any, baseDir: string): any[] {
  const errors: any[] = [];

  // Extract error responses (4xx, 5xx)
  for (const [code, rawResponse] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    if (isNaN(statusCode) && code !== 'default') continue;

    if (statusCode >= 400 || code === 'default') {
      // Resolve $ref on the response object itself
      const response = rawResponse.$ref ? resolveRef(rawResponse.$ref, spec, baseDir) : rawResponse;
      const content = response.content;
      let errorType = TYPE_ANY;
      let when = `HTTP ${code}`;

      if (content) {
        const jsonContent = content[CONTENT_TYPE_JSON];
        if (jsonContent?.schema) {
          const schema = jsonContent.schema;
          if (schema.$ref) {
            errorType = getTypeFromSchema(schema, spec, baseDir);
          } else if (schema.type && schema.type !== 'object') {
            // Primitive / array error schema — emit the primitive type
            // directly instead of wrapping in a dangling STRUCT(...).
            errorType = getTypeFromSchema(schema, spec, baseDir);
          } else {
            // Inline object error schema. Name it so extractStructs can
            // register the matching definition. Shared components.responses
            // entries get a stable name (Error{code} or Response_{key});
            // truly inline per-operation schemas get an operation-specific
            // name so two different 400 bodies don't collide on `Error400`.
            const errorStructName = getErrorStructName(rawResponse, op, code);
            errorType = `STRUCT(${errorStructName})`;
          }
        }
      }

      // Generate descriptive WHEN clause with HTTP status code
      when = generateErrorWhen(response, code);

      // v2.0.2: STATUS code is required in ERRORS
      const errorItem: any = {
        TYPE: errorType,
        STATUS: statusCode || (code === 'default' ? 500 : parseInt(code)),
        WHEN: when,
      };
      errors.push(errorItem);
    }
  }

  return errors;
}

function generateMethodAlias(operationId: string, method: string, path: string): string {
  if (operationId) {
    // Convert operationId to kebab-case if needed
    return operationId.replace(/_/g, '-').toLowerCase();
  }
  // Generate from path and method
  const pathParts = path.replace(/[\/{}]/g, '-').replace(/^-|-$/g, '');
  return `${method.toLowerCase()}-${pathParts}`;
}

function extractMethods(spec: any, baseDir: string): Record<string, any> {
  const methods: Record<string, any> = {};
  
  // Valid HTTP methods
  const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
  
  // Check if paths exists and is an object
  if (!spec.paths || typeof spec.paths !== 'object') {
    return methods;
  }
  
  for (const [pathStr, pathMethods] of Object.entries<any>(spec.paths)) {
    const pathLevelParams = pathMethods.parameters || [];
    
    for (const [method, op] of Object.entries<any>(pathMethods)) {
      // Skip extension fields (x-*) and only process valid HTTP methods
      if (method.startsWith('x-') || !validMethods.includes(method.toLowerCase())) {
        continue;
      }
      
      const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
      const alias = generateMethodAlias(operationId, method, pathStr);
      
      const summary = generateSummary(op, method, pathStr);
      const endpoint = pathStr;
      
      // Merge path-level and operation-level parameters (OpenAPI v3)
      const allParams = [...pathLevelParams, ...(op.parameters || [])];
      const opWithMergedParams = { ...op, parameters: allParams };
      
      const { contentType, bodyType } = getContentTypeAndBodyType(opWithMergedParams);
      const headers = getHeadersForOperation(opWithMergedParams, spec, method, baseDir);
      const pathQueryHeaderParams = extractParameters(opWithMergedParams, spec, baseDir);
      const bodyParams = extractRequestBody(opWithMergedParams, operationId, method, pathStr, spec, baseDir);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(opWithMergedParams, operationId, method, pathStr, spec, baseDir);
      const errors = extractErrors(opWithMergedParams, spec, baseDir);

      // Get accept content type from responses
      const acceptContentType = getAcceptContentType(opWithMergedParams);

      // Build method in v2.0.2 format
      const methodDef: any = {
        SUMMARY: summary,
      };

      // Add DESC if description exists
      if (op.description) {
        methodDef.DESC = op.description;
      }

      // HTTP section (mandatory for API methods)
      methodDef.HTTP = {
        METHOD: method.toUpperCase(),
        ENDPOINT: endpoint,
        HEADERS: headers,
        CONTENT_TYPE: contentType,
        ACCEPT: acceptContentType,
      };

      // v2.0.2: BODY.TYPE should be STRUCT(...) format
      if (bodyParams.length > 0 && bodyParams[0].body) {
        const bodyTypeValue = bodyParams[0].body.TYPE || bodyParams[0].body;
        methodDef.HTTP.BODY = {
          TYPE: bodyTypeValue,
        };
      }

      if (bodyType !== BODYTYPE_RAW) {
        methodDef.HTTP.BODYTYPE = bodyType;
      }

      // EXECUTION section (mandatory) - v2.0.2 requires KIND
      methodDef.EXECUTION = {
        KIND: 'http',
        MODE: EXECUTION_MODE_SYNC, // REST APIs are synchronous request/response
      };

      // INPUTS section (optional)
      if (inputParams.length > 0) {
        methodDef.INPUTS = inputParams;
      }

      // RETURNS section (optional - omit for void)
      if (returns.length > 0) {
        methodDef.RETURNS = returns;
      }

      // ERRORS section (optional)
      if (errors.length > 0) {
        methodDef.ERRORS = errors;
      }

      methods[alias] = methodDef;
    }
  }
  return methods;
}

function extractSecurityDefaults(spec: any): Record<string, string> {
  const defs: Record<string, string> = {};
  const securitySchemes = spec.components?.securitySchemes || {};
  
  for (const [_name, scheme] of Object.entries<any>(securitySchemes)) {
    if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
        defs.bearer_token = AUTH_TEMPLATE_BEARER;
      } else if (scheme.scheme === 'basic') {
        defs.basic_auth = AUTH_TEMPLATE_BASIC;
      } else if (scheme.scheme === 'digest') {
        defs.digest_auth = AUTH_TEMPLATE_DIGEST;
      } else {
        defs[`${scheme.scheme}_auth`] = `<${scheme.scheme.toUpperCase()}_CREDENTIALS>`;
      }
    } else if (scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        defs[scheme.name.toLowerCase()] = `<${scheme.name.toUpperCase()}>`;
      } else if (scheme.in === 'query') {
        defs[`query_${scheme.name.toLowerCase()}`] = `<${scheme.name.toUpperCase()}>`;
      } else if (scheme.in === 'cookie') {
        defs[`cookie_${scheme.name.toLowerCase()}`] = `<${scheme.name.toUpperCase()}>`;
      }
    } else if (scheme.type === 'oauth2') {
      defs.bearer_token = AUTH_TEMPLATE_BEARER_ACCESS;
    } else if (scheme.type === 'openIdConnect') {
      defs.id_token = AUTH_TEMPLATE_ID_TOKEN;
    }
  }
  
  // Add base URL
  const baseUrl = spec.servers?.[0]?.url || DEFAULT_BASE_URL;
  defs.w_base_url = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  
  return defs;
}

function updateReturnVarsUsingCanonicalId(methods: Record<string, any>): void {
  for (const methodData of Object.values<any>(methods)) {
    const canonicalId: string | undefined = methodData.CANONICAL_ID;
    if (!canonicalId || !Array.isArray(methodData.RETURNS)) continue;

    const baseVar = canonicalId.replace(/\./g, '_');

    for (const ret of methodData.RETURNS) {
      const status = ret.STATUS;
      if (status === 200 || status === '200') {
        ret.RETURNVAR = baseVar;
      } else if (status !== undefined && status !== null) {
        ret.RETURNVAR = `${baseVar}_${status}`;
      } else {
        ret.RETURNVAR = baseVar;
      }
    }
  }
}

function renameMethodsToCanonicalId(methods: Record<string, any>): Record<string, any> {
  const renamed: Record<string, any> = {};
  for (const [oldId, methodData] of Object.entries<any>(methods)) {
    const canonicalId: string | undefined = methodData.CANONICAL_ID;
    const key = canonicalId || oldId;
    renamed[key] = methodData;
  }
  return renamed;
}


function generateWrekenfile(spec: any, baseDir: string): string {
  try {
    // Validate inputs
    validateOpenApiV3Spec(spec);
    validateBaseDir(baseDir);

    const defaults = extractSecurityDefaults(spec);
    const methods = extractMethods(spec, baseDir);
    const structs = extractStructs(spec, baseDir);

    // Resolve canonical IDs for all methods
    const canonicalInputs: MethodCanonicalInput[] = Object.entries(methods).map(
      ([methodId, methodData]) => ({
        methodId,
        httpMethod: methodData.HTTP?.METHOD,
        endpoint: methodData.HTTP?.ENDPOINT,
        existingCanonicalId: methodData.CANONICAL_ID,
      })
    );
    const libraryName = spec?.info?.title || 'unknown';
    const canonicalIdMap = resolveCanonicalIds(canonicalInputs, libraryName);

    // Add CANONICAL_ID to each method
    for (const [methodId, methodData] of Object.entries(methods)) {
      const canonicalId = canonicalIdMap.get(methodId);
      if (canonicalId) {
        methodData.CANONICAL_ID = canonicalId;
      }
    }

    // Update RETURNVARs to be derived from CANONICAL_ID
    updateReturnVarsUsingCanonicalId(methods);

  const wrekenfile: any = {
    VERSION: WREKENFILE_VERSION,
  };

  // Add DEFAULTS if we have any
  if (Object.keys(defaults).length > 0) {
    wrekenfile.DEFAULTS = defaults;
  }

  // Add METHODS (mandatory) - use CANONICAL_ID as key when available
  const renamedMethods = renameMethodsToCanonicalId(methods);
  wrekenfile.METHODS = renamedMethods;

  // Add STRUCTS if we have any
  const preFilterStructCount = Object.keys(structs).length;
  if (preFilterStructCount > 0) {
    wrekenfile.STRUCTS = structs;
  }

  // Remove unused STRUCTS (keep only those referenced by METHODS)
  filterStructsByUsage(wrekenfile);

    // Generate YAML string using the standard pipeline
    return generateYamlString(wrekenfile);
  } catch (err: any) {
    // Log error with context
    logError(err, {
      converter: 'openapi-to-wreken',
      baseDir,
      specInfo: spec?.info?.title || 'unknown',
      specVersion: spec?.openapi || 'unknown'
    });
    
    // Re-throw with additional context if it's not already a ConverterError
    if (err.code && (err.code.startsWith('INVALID_') || err.code.startsWith('MISSING_'))) {
      throw err;
    }
    
    throw createConverterError(
      `Failed to generate Wrekenfile from OpenAPI v3 spec: ${err.message}`,
      "GENERATION_FAILED",
      {
        converter: 'openapi-to-wreken',
        baseDir,
        specInfo: spec?.info?.title || 'unknown',
        specVersion: spec?.openapi || 'unknown'
      },
      err
    );
  }
}

/**
 * Generate a Wrekenfile and return both the YAML string and conversion stats.
 * Use this when you need visibility into what was converted and potential issues.
 */
function generateWrekenfileWithStats(spec: any, baseDir: string): { yaml: string; stats: ConversionStats } {
  try {
    // Validate inputs
    validateOpenApiV3Spec(spec);
    validateBaseDir(baseDir);

    const defaults = extractSecurityDefaults(spec);
    const methods = extractMethods(spec, baseDir);
    const structs = extractStructs(spec, baseDir);

    // Resolve canonical IDs
    const canonicalInputs: MethodCanonicalInput[] = Object.entries(methods).map(
      ([methodId, methodData]) => ({
        methodId,
        httpMethod: methodData.HTTP?.METHOD,
        endpoint: methodData.HTTP?.ENDPOINT,
        existingCanonicalId: methodData.CANONICAL_ID,
      })
    );
    const libraryName = spec?.info?.title || 'unknown';
    const canonicalIdMap = resolveCanonicalIds(canonicalInputs, libraryName);
    for (const [methodId, methodData] of Object.entries(methods)) {
      const canonicalId = canonicalIdMap.get(methodId);
      if (canonicalId) {
        methodData.CANONICAL_ID = canonicalId;
      }
    }
    updateReturnVarsUsingCanonicalId(methods);

    const wrekenfile: any = { VERSION: WREKENFILE_VERSION };
    if (Object.keys(defaults).length > 0) {
      wrekenfile.DEFAULTS = defaults;
    }
    const renamedMethods = renameMethodsToCanonicalId(methods);
    wrekenfile.METHODS = renamedMethods;

    const preFilterStructCount = Object.keys(structs).length;
    if (preFilterStructCount > 0) {
      wrekenfile.STRUCTS = structs;
    }
    filterStructsByUsage(wrekenfile);

    const stats = computeConversionStats(wrekenfile, preFilterStructCount);
    const yaml = generateYamlString(wrekenfile);

    return { yaml, stats };
  } catch (err: any) {
    logError(err, {
      converter: 'openapi-to-wreken',
      baseDir,
      specInfo: spec?.info?.title || 'unknown',
      specVersion: spec?.openapi || 'unknown'
    });

    if (err.code && (err.code.startsWith('INVALID_') || err.code.startsWith('MISSING_'))) {
      throw err;
    }

    throw createConverterError(
      `Failed to generate Wrekenfile from OpenAPI v3 spec: ${err.message}`,
      "GENERATION_FAILED",
      {
        converter: 'openapi-to-wreken',
        baseDir,
        specInfo: spec?.info?.title || 'unknown',
        specVersion: spec?.openapi || 'unknown'
      },
      err
    );
  }
}

// Export for programmatic use
export { generateWrekenfile, generateWrekenfileWithStats };

