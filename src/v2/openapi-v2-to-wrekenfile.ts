// openapi-v2-swagger-to-wrekenfile-v2.ts
// Converts OpenAPI v2 (Swagger) specifications to Wrekenfile v2.0.1 format
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
  DEFAULT_HTTP_SCHEME,
  CONTENT_TYPE_JSON,
  CONTENT_TYPE_FORM_DATA,
  CONTENT_TYPE_URLENCODED,
  HEADER_CONTENT_TYPE,
  HEADER_AUTHORIZATION,
  AUTH_BEARER_TOKEN,
  AUTH_BASIC_AUTH,
  AUTH_TEMPLATE_BEARER_ACCESS,
  AUTH_TEMPLATE_BASIC,
  AUTH_TEMPLATE_ID_TOKEN,
  HTTP_METHODS_WITH_BODY,
} from './utils/constants';
import { generateReturnVarName, generateErrorWhen } from './utils/response-utils';
import { mapOpenApiType, Primitive } from './utils/type-utils';
import { generateOpenApiSummary } from './utils/summary-utils';

const externalRefCache: Record<string, any> = {};

// Re-export for backward compatibility
const mapType = mapOpenApiType;
const generateSummary = generateOpenApiSummary;

function resolveRef(ref: string, spec: any, baseDir: string): any {
  if (ref.startsWith('#/')) {
    return ref.split('/').slice(1).reduce((o, k) => o?.[k], spec);
  }
  const [filePath, internal] = ref.split('#');
  const fullPath = path.resolve(baseDir, filePath);
  if (!externalRefCache[fullPath]) {
    const content = fs.readFileSync(fullPath, 'utf8');
    externalRefCache[fullPath] = load(content);
  }
  return internal
    ? internal.split('/').slice(1).reduce((o, k) => o?.[k], externalRefCache[fullPath])
    : externalRefCache[fullPath];
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
  if (schema && typeof schema === 'object' && schema.$ref) {
    return parseSchema(name, resolveRef(schema.$ref, spec, baseDir), spec, baseDir, depth + 1);
  }
  if (schema && typeof schema === 'object' && schema.allOf) {
    return schema.allOf.flatMap((s: any) => parseSchema(name, s, spec, baseDir, depth + 1));
  }
  if (schema && typeof schema === 'object' && (schema.oneOf || schema.anyOf)) {
    return [{
      name: 'variant',
      type: `STRUCT(${name}_Union)`,
      REQUIRED: false
    }];
  }

  const fields: any[] = [];

  if (schema && typeof schema === 'object' && schema.discriminator?.propertyName) {
    fields.push({
      name: schema.discriminator.propertyName,
      type: 'STRING',
      REQUIRED: true,
    });
  }

  // Handle simple types (string, integer, etc.) - these should not create structs
  if (schema && typeof schema === 'object' && schema.type && schema.type !== 'object' && schema.type !== 'array') {
    return [];
  }

  if (schema && typeof schema === 'object' && schema.type === 'object' && schema.properties) {
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
  const definitions = spec.definitions || {}; // OpenAPI v2 uses 'definitions' instead of 'components.schemas'
  
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
  
  // Extract schemas from definitions (OpenAPI v2)
  for (const name in definitions) {
    collectAllReferencedSchemas(definitions[name], name);
    const schema = definitions[name];
    if (schema && (schema.oneOf || schema.anyOf)) {
      structs[`${name}_Union`] = [{ name: 'value', type: 'ANY', REQUIRED: false }];
    }
  }
  
  // Extract inline schemas from operations
  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathStr, pathMethods] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(pathMethods)) {
        const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
        
        // Extract request body schemas (OpenAPI v2 uses parameters with in: body)
        if (op.parameters) {
          for (const param of op.parameters) {
            if (param && typeof param === 'object' && param.in === 'body' && param.schema) {
              if (param.schema && param.schema.$ref) {
                const refName = param.schema.$ref.split('/').pop();
                if (refName) collectAllReferencedSchemas(resolveRef(param.schema.$ref, spec, baseDir), refName);
              } else if (param.schema && typeof param.schema === 'object') {
                const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
                collectAllReferencedSchemas(param.schema, requestStructName);
              }
            }
          }
        }
        
        // Extract response schemas (OpenAPI v2 has schema directly in response)
        if (op.responses) {
          for (const [code, response] of Object.entries<any>(op.responses)) {
            // Handle response references
            let actualResponse = response;
            if (response && typeof response === 'object' && response.$ref) {
              actualResponse = resolveRef(response.$ref, spec, baseDir);
            }
            
            if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
              if (actualResponse.schema && actualResponse.schema.$ref) {
                const refName = actualResponse.schema.$ref.split('/').pop();
                if (refName) collectAllReferencedSchemas(resolveRef(actualResponse.schema.$ref, spec, baseDir), refName);
              } else if (actualResponse.schema && typeof actualResponse.schema === 'object') {
                const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}`);
                collectAllReferencedSchemas(actualResponse.schema, responseStructName);
              }
            }
          }
        }
      }
    }
  }
  
  return structs;
}

function getContentTypeAndBodyType(op: any, spec: any): { contentType: string; bodyType: string } {
  // Check if there are formData parameters
  const hasFormData = op.parameters?.some((param: any) => param && typeof param === 'object' && param.in === 'formData');
  
  if (hasFormData) {
    return { contentType: CONTENT_TYPE_FORM_DATA, bodyType: 'form-data' };
  }
  
  // OpenAPI v2 determines content type from consumes array or defaults
  const consumes = op.consumes || spec.consumes || [CONTENT_TYPE_JSON];
  const contentType = consumes[0] || CONTENT_TYPE_JSON;
  
  let bodyType = BODYTYPE_RAW;
  if (contentType === CONTENT_TYPE_FORM_DATA) {
    bodyType = 'form-data';
  } else if (contentType === CONTENT_TYPE_URLENCODED) {
    bodyType = 'x-www-form-urlencoded';
  }

  return { contentType, bodyType };
}

function getHeadersForOperation(op: any, spec: any, method?: string, baseDir?: string): Record<string, string> {
  const { contentType } = getContentTypeAndBodyType(op, spec);
  
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
      const scheme = spec.securityDefinitions?.[schemeName]; // OpenAPI v2 uses securityDefinitions
      if (scheme) {
        if (scheme.type === 'basic') {
          headerMap.set(HEADER_AUTHORIZATION, AUTH_BASIC_AUTH);
        } else if (scheme.type === 'apiKey') {
          if (scheme.in === 'header') {
            headerMap.set(scheme.name, scheme.name.toLowerCase());
          }
        } else if (scheme.type === 'oauth2') {
          headerMap.set(HEADER_AUTHORIZATION, AUTH_BEARER_TOKEN);
        }
      }
    }
  }
  
  // Check if Authorization is used as a parameter but not defined in securityDefinitions
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
  
  // Handle path, query, and header parameters
  if (op.parameters) {
    for (let param of op.parameters) {
      // Resolve parameter references
      if (param && typeof param === 'object' && param.$ref) {
        param = resolveRef(param.$ref, spec, baseDir);
      }
      
      // Skip body and formData parameters, they are handled in extractRequestBody
      if (param && typeof param === 'object' && (param.in === 'body' || param.in === 'formData')) {
        continue;
      }
      
      const paramName = param && typeof param === 'object' ? param.name : '';
      const paramSchema = param && typeof param === 'object' ? param.schema || {} : {};
      const paramIn = param && typeof param === 'object' ? param.in || 'query' : 'query';
      
      // Path parameters are always required in OpenAPI v2
      // Query and header parameters default to false if not specified
      const isRequired = paramIn === 'path'
        ? (param && typeof param === 'object' ? param.required !== false : true)  // Path params default to true
        : (param && typeof param === 'object' ? param.required === true : false);  // Query/header params default to false
      const hasDefault = paramSchema && typeof paramSchema === 'object' ? paramSchema.default !== undefined : false;
      
      let type = 'STRING';
      if (param && typeof param === 'object' && param.type) {
        type = getTypeFromSchema({ type: param.type, format: param.format }, spec, baseDir);
      } else if (paramSchema && typeof paramSchema === 'object' && paramSchema.type) {
        type = getTypeFromSchema(paramSchema, spec, baseDir);
      }
      
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
  }
  
  return inputParams;
}

function extractRequestBody(op: any, operationId: string, method: string, path: string, spec: any, baseDir: string): any[] {
  const inputParams: any[] = [];
  
  // OpenAPI v2 uses parameters with in: body
  const bodyParam = (op.parameters || []).find((p: any) => p && typeof p === 'object' && p.in === 'body');

  if (bodyParam) {
    let type: string;
    if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema?.$ref) {
      type = getTypeFromSchema(bodyParam.schema, spec, baseDir);
    } else if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema) {
      // Inline schema - use generated struct name
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    } else {
      type = 'ANY';
    }
    
    // In OpenAPI v2, body parameters default to false (optional) if not specified
    const isRequired = bodyParam && typeof bodyParam === 'object' ? bodyParam.required === true : false;
    
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
  }
  
  // Handle formData for multipart/form-data (OpenAPI v2)
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param && typeof param === 'object' && param.in === 'formData') {
        const type = param.type === 'file' ? 'STRING' : getTypeFromSchema({ type: param.type, format: param.format }, spec, baseDir);
        // FormData parameters default to false (optional) if not specified
        const isRequired = param.required === true;
        const hasDefault = param.default !== undefined;
        
        const inputParam: any = {};
        if (isRequired && !hasDefault) {
          // Simple form
          inputParam[param.name] = type;
        } else {
          // Extended form
          inputParam[param.name] = {
            TYPE: type,
            REQUIRED: isRequired,
          };
          if (hasDefault) {
            inputParam[param.name].DEFAULT = param.default;
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
    if (isNaN(statusCode) || statusCode < 200 || statusCode >= 300) {
      continue;
    }

    // Handle response references (OpenAPI v2)
    let actualResponse = response;
    if (response && typeof response === 'object' && response.$ref) {
      actualResponse = resolveRef(response.$ref, spec, baseDir);
    }
    
    let returnType: string | null = null;

    // 204 No Content - no response body
    if (code === '204') {
      continue;
    }

    if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
      const schema = actualResponse.schema;
      if (schema.$ref) {
        returnType = getTypeFromSchema(schema, spec, baseDir);
      } else if (schema.type === 'array') {
        if (schema.items?.$ref) {
          returnType = getTypeFromSchema(schema, spec, baseDir);
        } else {
          returnType = getTypeFromSchema(schema, spec, baseDir);
        }
      } else if (schema.type === 'object') {
        // Inline schema - use generated struct name
        const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
        returnType = `STRUCT(${responseStructName})`;
      } else {
        returnType = getTypeFromSchema(schema, spec, baseDir);
      }
    } else {
      // No schema - might be a header-only response
      const statusCode = parseInt(code);
      if (statusCode >= 200 && statusCode < 300) {
        continue; // Skip void success responses
      }
      returnType = 'ANY'; // Error responses without schema
    }

    // Only add to RETURNS if there's actually a return type
    if (returnType) {
      // Generate descriptive RETURNVAR name based on response code and operation
      const returnVarName = generateReturnVarName(operationId, code);

      const returnItem: any = {
        RETURNTYPE: returnType,
        RETURNVAR: returnVarName,
      };

      // Check for pagination hints in response schema
      if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
        const schema = actualResponse.schema;
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
      // Handle response references
      let actualResponse = response;
      if (response && typeof response === 'object' && response.$ref) {
        actualResponse = resolveRef(response.$ref, spec, baseDir);
      }
      
      let errorType = TYPE_ANY;
      let when = `HTTP ${code}`;

      if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
        const schema = actualResponse.schema;
        if (schema.$ref) {
          errorType = getTypeFromSchema(schema, spec, baseDir);
        } else {
          // Inline error schema - generate a struct name
          const errorStructName = `Error${code}`;
          errorType = `STRUCT(${errorStructName})`;
        }
      }

      // Generate descriptive WHEN clause with HTTP status code
      when = generateErrorWhen(actualResponse, code);

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
  // OpenAPI v2 constructs base URL from schemes, host, and basePath
  const scheme = spec.schemes?.[0] || DEFAULT_HTTP_SCHEME;
  const host = spec.host || '';
  const basePath = spec.basePath || '';
  const base = `${scheme}://${host}${basePath}`;
  
  const methods: Record<string, any> = {};
  
  // Valid HTTP methods
  const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
  
  // Check if paths exists and is an object
  if (!spec.paths || typeof spec.paths !== 'object') {
    return methods;
  }
  
  for (const [pathStr, pathMethods] of Object.entries<any>(spec.paths)) {
    // Handle path-level parameters (OpenAPI v2)
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
      
      // Merge path-level and operation-level parameters
      const allParams = [...pathLevelParams, ...(op.parameters || [])];
      const opWithMergedParams = { ...op, parameters: allParams };
      
      const { bodyType } = getContentTypeAndBodyType(opWithMergedParams, spec);
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
  const securityDefinitions = spec.securityDefinitions || {}; // OpenAPI v2 uses securityDefinitions
  
  for (const [name, scheme] of Object.entries<any>(securityDefinitions)) {
    if (scheme && typeof scheme === 'object' && scheme.type === 'basic') {
      defs.basic_auth = AUTH_TEMPLATE_BASIC;
    } else if (scheme && typeof scheme === 'object' && scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        defs[scheme.name.toLowerCase()] = `<${scheme.name.toUpperCase()}>`;
      } else if (scheme.in === 'query') {
        defs[`query_${scheme.name.toLowerCase()}`] = `<${scheme.name.toUpperCase()}>`;
      } else if (scheme.in === 'cookie') {
        defs[`cookie_${scheme.name.toLowerCase()}`] = `<${scheme.name.toUpperCase()}>`;
      }
    } else if (scheme && typeof scheme === 'object' && scheme.type === 'oauth2') {
      defs.bearer_token = AUTH_TEMPLATE_BEARER_ACCESS;
    }
  }
  
  // Add base URL (OpenAPI v2 constructs from schemes, host, basePath)
  const scheme = spec.schemes?.[0] || 'https';
  const host = spec.host || '';
  const basePath = spec.basePath || '';
  const baseUrl = `${scheme}://${host}${basePath}`;
  defs.w_base_url = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  
  return defs;
}


function generateWrekenfile(spec: any, baseDir: string): string {
  if (!spec || typeof spec !== 'object') {
    throw new Error("Argument 'spec' is required and must be an object");
  }
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error("Argument 'baseDir' is required and must be a string");
  }

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
}

// Export for programmatic use
export { generateWrekenfile };

