// openapi-to-wrekenfile-v2.ts
// Converts OpenAPI v3 specifications to Wrekenfile v2.0.1 format
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { generateYamlString } from './utils/yaml-utils';
import { 
  WREKENFILE_VERSION, 
  DEFAULT_BASE_URL, 
  YAML_DUMP_OPTIONS,
  EXECUTION_MODE_ASYNC,
  ASYNC_RETURNS_RESULT,
  TYPE_VOID,
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
import { mapOpenApiType, Primitive } from './utils/type-utils';
import { generateOpenApiSummary } from './utils/summary-utils';
import { validateOpenApiV3Spec, validateBaseDir, logError, createConverterError } from './utils/error-utils';

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

function getTypeFromSchema(schema: any, spec: any, baseDir: string): string {
  if (!schema || typeof schema !== 'object') {
    return 'ANY';
  }
  if (schema.$ref) {
    const resolvedSchema = resolveRef(schema.$ref, spec, baseDir);
    if (resolvedSchema && resolvedSchema.type && resolvedSchema.type !== 'object') {
      return mapType(resolvedSchema.type, resolvedSchema.format);
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
    // For unions, create a simple struct
    return [{
      name: 'variant',
      type: `STRUCT(${name}_Union)`,
      REQUIRED: false
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

function generateStructName(operationId: string, method: string, path: string, suffix: string): string {
  if (operationId) {
    return `${operationId}${suffix}`;
  }
  // Generate from path and method
  const pathParts = path.replace(/[\/{}]/g, '_').replace(/^_|_$/g, '');
  return `${method}_${pathParts}${suffix}`;
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
      structs[`${name}_Union`] = [{ name: 'value', type: 'ANY', REQUIRED: false }];
    }
  }
  
  // Extract inline schemas from operations
  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
        // Extract request body schemas
        if (op.requestBody?.content) {
          for (const [contentType, content] of Object.entries<any>(op.requestBody.content)) {
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
          for (const [code, response] of Object.entries<any>(op.responses)) {
            if (response && response.content) {
              for (const [contentType, content] of Object.entries<any>(response.content)) {
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
                    // Inline object schema - create struct
                    const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}`);
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
    for (const [schemeName, scopes] of Object.entries(securityRequirement)) {
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
  
  // Handle query parameters only
  // Path parameters are already in ENDPOINT (e.g., /tasks/{taskId})
  // Header parameters are in HTTP.HEADERS
  // Body parameters are handled separately in extractRequestBody
  for (let param of op.parameters || []) {
    // Resolve $ref if present
    if (param.$ref) {
      param = resolveRef(param.$ref, spec, baseDir);
    }

    const paramIn = param.in || 'query';
    
    // Skip path parameters - they're already in the ENDPOINT
    if (paramIn === 'path') {
      continue;
    }
    
    // Skip header parameters - they're in HTTP.HEADERS
    if (paramIn === 'header') {
      continue;
    }
    
    // Only process query parameters
    if (paramIn !== 'query') {
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
    
    // Query parameters default to false if not specified
    const isRequired = param.required === true;
    const hasDefault = paramSchema.default !== undefined;
    
    // Build input parameter in v2.0.1 format
    // Use simple form if required and no default, extended form otherwise
    if (isRequired && !hasDefault) {
      // Simple form: - paramName: TYPE
      const inputParam: any = {};
      inputParam[paramName] = type;
      inputParams.push(inputParam);
    } else {
      // Extended form: - paramName: { TYPE: ..., REQUIRED: ..., DEFAULT: ... }
      const inputParam: any = {};
      inputParam[paramName] = {
        TYPE: type,
        REQUIRED: isRequired,
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
    if (isRequired) {
      // Simple form
      const inputParam: any = {};
      inputParam.body = type;
      inputParams.push(inputParam);
    } else {
      // Extended form
      const inputParam: any = {};
      inputParam.body = {
        TYPE: type,
        REQUIRED: false,
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
        if (required && !hasDefault) {
          // Simple form
          inputParam[key] = type;
        } else {
          // Extended form
          inputParam[key] = {
            TYPE: type,
            REQUIRED: required,
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
        if (required && !hasDefault) {
          // Simple form
          inputParam[key] = type;
        } else {
          // Extended form
          inputParam[key] = {
            TYPE: type,
            REQUIRED: required,
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
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    
    // Only process 2xx success responses
    if (statusCode < 200 || statusCode >= 300) {
      continue;
    }

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

      const returnItem: any = {
        RETURNTYPE: returnType,
        RETURNVAR: returnVarName,
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
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    if (isNaN(statusCode) && code !== 'default') continue;
    
    if (statusCode >= 400 || code === 'default') {
      const content = response.content;
      let errorType = TYPE_ANY;
      let when = `HTTP ${code}`;

      if (content) {
        const jsonContent = content[CONTENT_TYPE_JSON];
        if (jsonContent?.schema) {
          const schema = jsonContent.schema;
          if (schema.$ref) {
            errorType = getTypeFromSchema(schema, spec, baseDir);
          } else {
            // Inline error schema - generate a struct name
            const errorStructName = `Error${code}`;
            errorType = `STRUCT(${errorStructName})`;
          }
        }
      }

      // Generate descriptive WHEN clause with HTTP status code
      when = generateErrorWhen(response, code);

      errors.push({
        TYPE: errorType,
        WHEN: when,
      });
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
  const base = spec.servers?.[0]?.url || '';
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
      
      const { bodyType } = getContentTypeAndBodyType(opWithMergedParams);
      const headers = getHeadersForOperation(opWithMergedParams, spec, method, baseDir);
      const pathQueryHeaderParams = extractParameters(opWithMergedParams, spec, baseDir);
      const bodyParams = extractRequestBody(opWithMergedParams, operationId, method, pathStr, spec, baseDir);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(opWithMergedParams, operationId, method, pathStr, spec, baseDir);
      const errors = extractErrors(opWithMergedParams, spec, baseDir);

      // Build method in v2.0.1 format
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
      };

      if (bodyType !== BODYTYPE_RAW) {
        methodDef.HTTP.BODYTYPE = bodyType;
      }

      // EXECUTION section (mandatory)
      methodDef.EXECUTION = {
        MODE: EXECUTION_MODE_ASYNC, // HTTP methods default to async
      };

      // ASYNC section (required when MODE = async)
      const resultType = returns.length > 0 ? returns[0].RETURNTYPE : TYPE_VOID;
      methodDef.ASYNC = {
        RETURNS: ASYNC_RETURNS_RESULT,
        RESULT: {
          TYPE: resultType,
        },
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
  
  for (const [name, scheme] of Object.entries<any>(securitySchemes)) {
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


function generateWrekenfile(spec: any, baseDir: string): string {
  try {
    // Validate inputs
    validateOpenApiV3Spec(spec);
    validateBaseDir(baseDir);

    const defaults = extractSecurityDefaults(spec);
    const methods = extractMethods(spec, baseDir);
    const structs = extractStructs(spec, baseDir);

  const wrekenfile: any = {
    VERSION: WREKENFILE_VERSION,
  };

  // Add DEFAULTS if we have any
  if (Object.keys(defaults).length > 0) {
    wrekenfile.DEFAULTS = defaults;
  }

  // Add METHODS (mandatory)
  wrekenfile.METHODS = methods;

  // Add STRUCTS if we have any
  if (Object.keys(structs).length > 0) {
    wrekenfile.STRUCTS = structs;
  }

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
    if (err.code && err.code.startsWith('INVALID_') || err.code?.startsWith('MISSING_')) {
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
export { generateWrekenfile };

