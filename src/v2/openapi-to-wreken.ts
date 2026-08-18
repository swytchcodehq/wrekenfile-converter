// openapi-to-wrekenfile-v2.ts
// Converts OpenAPI v3 specifications to Wrekenfile v2.0.2 format



import { load } from 'js-yaml';
import { generateYamlString } from './utils/yaml-utils';
import { 
  WREKENFILE_VERSION,
  DEFAULT_BASE_URL,
  EXECUTION_MODE_SYNC,
  EXECUTION_MODE_ASYNC,
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
import { generateOpenApiSummary } from './utils/summary-utils';
import { validateOpenApiV3Spec, validateBaseDir, logError, createConverterError } from './utils/error-utils';
import { resolveCanonicalIds, type MethodCanonicalInput } from './utils/canonical-id';
import { filterStructsByUsage } from './utils/struct-utils';
import { computeConversionStats, type ConversionStats } from './utils/conversion-stats';

import { RefResolver, sanitizeName } from './utils/ref-utils';
import {
  extractStructs,
  getTypeFromSchema,
  generateStructName,
  getErrorStructName,
  isStructSchema,
  getSingleAllOfRef,
  applyConstraints,
} from './utils/schema-utils';



// Re-export for backward compatibility

const generateSummary = generateOpenApiSummary;


function getContentTypeAndBodyType(op: any): { contentType: string; bodyType: string } {
  const requestBody = op.requestBody;
  if (!requestBody?.content) {
    return { contentType: CONTENT_TYPE_JSON, bodyType: BODYTYPE_RAW };
  }

  const contentTypes = Object.keys(requestBody.content);
  const contentType = contentTypes.includes(CONTENT_TYPE_JSON) ? CONTENT_TYPE_JSON : (contentTypes[0] || CONTENT_TYPE_JSON);
  
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
        return contentTypes.includes(CONTENT_TYPE_JSON) ? CONTENT_TYPE_JSON : contentTypes[0];
      }
    }
  }
  // Default to JSON if no response content type found
  return CONTENT_TYPE_JSON;
}

function getHeadersForOperation(op: any, spec: any, method?: string, resolver?: RefResolver): Record<string, string> {
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
        param = resolver ? resolver.resolveRef(param.$ref) : param;
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

function extractParameters(op: any, _spec: any, resolver: RefResolver, operationId: string, method: string, pathStr: string): any[] {
  const inputParams: any[] = [];
  
  // v2.0.2: All parameters (path, query, header) must be in INPUTS with LOCATION
  // Path parameters are also in ENDPOINT (e.g., /tasks/{taskId})
  // Header parameters are also in HTTP.HEADERS
  // Body parameters are handled separately in extractRequestBody
  for (let param of op.parameters || []) {
    // Resolve $ref if present
    if (param.$ref) {
      param = resolver.resolveRef(param.$ref);
    }

    const paramIn = param.in || 'query';
    
    // Skip body parameters - they're handled in extractRequestBody
    if (paramIn === 'body' || paramIn === 'formData') {
      continue;
    }

    const paramName = param.name;
    const paramSchema = param.schema;
    
    let type = 'STRING';
    if (paramSchema) {
      type = getTypeFromSchema(paramSchema, resolver);
      if (type === 'OBJECT' && !paramSchema.$ref) {
        const structName = generateStructName(operationId, method, pathStr, `Param_${param.name}`);
        type = `STRUCT(${sanitizeName(structName)})`;
      } else if (type === '[]OBJECT' && !paramSchema.$ref) {
        const structName = generateStructName(operationId, method, pathStr, `Param_${param.name}_Item`);
        type = `[]STRUCT(${sanitizeName(structName)})`;
      } else if (type === 'map[STRING]OBJECT' && !paramSchema.$ref) {
        const structName = generateStructName(operationId, method, pathStr, `Param_${param.name}_Value`);
        type = `map[STRING]STRUCT(${sanitizeName(structName)})`;
      }
    }
    
    const isRequired = param.required === true;
    const hasDefault = paramSchema?.default !== undefined;
    
    // v2.0.2: All INPUTS must have LOCATION field
    // Build input parameter with LOCATION
    const inputParam: any = {};
    inputParam[paramName] = {
      TYPE: type,
      REQUIRED: isRequired,
      LOCATION: paramIn,
    };
    if (hasDefault) {
      inputParam[paramName].DEFAULT = paramSchema.default;
    }
    if (paramSchema) {
      applyConstraints(inputParam[paramName], paramSchema);
    }
    if (param.style) inputParam[paramName].STYLE = param.style;
    if (param.explode !== undefined) inputParam[paramName].EXPLODE = param.explode;
    if (param.deprecated === true) inputParam[paramName].DEPRECATED = true;
    if (param.example !== undefined) inputParam[paramName].EXAMPLE = param.example;
    inputParams.push(inputParam);
  }
  
  return inputParams;
}

function extractRequestBody(op: any, operationId: string, method: string, path: string, _spec: any, resolver: RefResolver): any[] {
  const inputParams: any[] = [];
  const requestBody = op.requestBody;
  if (!requestBody?.content) {
    return inputParams;
  }
  // Pick by priority (JSON, then multipart, then urlencoded) rather than
  // declaration order. If none of the structured types have a schema,
  // fallback to the first available content type (e.g. application/octet-stream, text/plain)
  const contentTypes = Object.keys(requestBody.content);
  let contentType = [CONTENT_TYPE_JSON, 'multipart/form-data', 'application/x-www-form-urlencoded']
    .find((ct) => contentTypes.includes(ct) && requestBody.content[ct]?.schema);
    
  if (!contentType && contentTypes.length > 0) {
    // If no preferred type with a schema is found, pick the first available content type
    // even if it lacks a schema (e.g., raw binary uploads)
    contentType = contentTypes[0];
  }

  if (!contentType) {
    return inputParams;
  }

  if (contentType === CONTENT_TYPE_JSON || (!['multipart/form-data', 'application/x-www-form-urlencoded'].includes(contentType))) {
    const bodyObj = requestBody.content[contentType];
    const bodySchema = bodyObj?.schema;
    let type: string;
    if (bodySchema && (bodySchema.$ref || getSingleAllOfRef(bodySchema))) {
      type = getTypeFromSchema(bodySchema, resolver);
    } else if (bodySchema && isStructSchema(bodySchema)) {
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    } else if (bodySchema) {
      // Non-object inline schema (array, primitive, map)
      type = getTypeFromSchema(bodySchema, resolver);
      if (type === '[]OBJECT') {
        const requestStructName = generateStructName(operationId, method, path, 'RequestItem');
        type = `[]STRUCT(${requestStructName})`;
      } else if (type === 'map[STRING]OBJECT') {
        const requestStructName = generateStructName(operationId, method, path, 'RequestValue');
        type = `map[STRING]STRUCT(${requestStructName})`;
      }
    } else {
      type = 'ANY';
    }
    
    const isRequired = requestBody.required === true;
    // v2.0.2: All INPUTS must have LOCATION field
    const inputParam: any = {};
    inputParam.body = {
      TYPE: type,
      REQUIRED: isRequired,
      LOCATION: 'body',
      CONTENT_TYPE: contentType,
    };
    if (bodySchema) {
      applyConstraints(inputParam.body, bodySchema);
    }
    inputParams.push(inputParam);
  } else if (contentType === 'multipart/form-data' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    if (bodySchema && bodySchema.properties) {
      for (const [key, prop] of Object.entries<any>(bodySchema.properties)) {
        let type = prop && prop.format === 'binary' ? 'BINARY' : getTypeFromSchema(prop, resolver);
        if (prop && prop.type === 'array' && prop.items && prop.items.format === 'binary') {
          type = '[]BINARY';
        }
        if (type === 'OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `STRUCT(${sanitizeName(requestStructName + '_' + key)})`;
        } else if (type === '[]OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `[]STRUCT(${sanitizeName(requestStructName + '_' + key + '_Item')})`;
        } else if (type === 'map[STRING]OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `map[STRING]STRUCT(${sanitizeName(requestStructName + '_' + key + '_Value')})`;
        }
        const required = (bodySchema.required || []).includes(key);
        const hasDefault = prop && prop.default !== undefined;
        
        const inputParam: any = {};
        // v2.0.2: All INPUTS must have LOCATION field
        inputParam[key] = {
          TYPE: type,
          REQUIRED: required,
          LOCATION: 'body',
        };
        if (hasDefault) {
          inputParam[key].DEFAULT = prop.default;
        }
        if (prop) {
          applyConstraints(inputParam[key], prop);
        }
        inputParams.push(inputParam);
      }
    }
  } else if (contentType === 'application/x-www-form-urlencoded' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    if (bodySchema && bodySchema.properties) {
      for (const [key, prop] of Object.entries<any>(bodySchema.properties)) {
        const typeRaw = getTypeFromSchema(prop, resolver);
        let type = typeRaw;
        if (typeRaw === 'OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `STRUCT(${sanitizeName(requestStructName + '_' + key)})`;
        } else if (typeRaw === '[]OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `[]STRUCT(${sanitizeName(requestStructName + '_' + key + '_Item')})`;
        } else if (typeRaw === 'map[STRING]OBJECT' && !prop.$ref) {
           const requestStructName = generateStructName(operationId, method, path, 'Request');
           type = `map[STRING]STRUCT(${sanitizeName(requestStructName + '_' + key + '_Value')})`;
        }
        const required = (bodySchema.required || []).includes(key);
        const hasDefault = prop && prop.default !== undefined;
        
        const inputParam: any = {};
        // v2.0.2: All INPUTS must have LOCATION field
        inputParam[key] = {
          TYPE: type,
          REQUIRED: required,
          LOCATION: 'body',
        };
        if (hasDefault) {
          inputParam[key].DEFAULT = prop.default;
        }
        if (prop) {
          applyConstraints(inputParam[key], prop);
        }
        inputParams.push(inputParam);
      }
    }
  }
  return inputParams;
}

function extractResponses(op: any, operationId: string, method: string, path: string, _spec: any, resolver: RefResolver): any[] {
  const returns: any[] = [];

  // Only include success responses (2xx) in RETURNS section
  // Error responses go in ERRORS section
  for (const [code, rawResponse] of Object.entries<any>(op.responses || {})) {
    const normalizedCode = code.toLowerCase();
    let statusCode = parseInt(code);
    if (normalizedCode.endsWith('xx')) {
      statusCode = parseInt(normalizedCode.charAt(0)) * 100;
    }

    // Only process 2xx success responses
    // 'default' becomes NaN, which fails the condition and will skip
    if (isNaN(statusCode) || statusCode < 200 || statusCode >= 300) {
      continue;
    }

    // Resolve $ref on the response object itself (e.g. $ref: '#/components/responses/...')
    const response = rawResponse.$ref ? resolver.resolveRef(rawResponse.$ref) : rawResponse;

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
          returnType = getTypeFromSchema(schema, resolver);
        
        // If it's an inline object schema (not array, not $ref), we need to create a struct.
        // getTypeFromSchema only returns 'OBJECT' when isStructSchema(schema) is true, which
        // also covers object schemas without an explicit "type": "object" (common in the wild).
        if (returnType === 'OBJECT' && !schema.$ref) {
          const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
          returnType = `STRUCT(${responseStructName})`;
        } else if (returnType === '[]OBJECT' && !schema.$ref) {
          const responseStructName = generateStructName(operationId, method, path, `Response${code}Item`);
          returnType = `[]STRUCT(${responseStructName})`;
        } else if (returnType === 'map[STRING]OBJECT' && !schema.$ref) {
          const responseStructName = generateStructName(operationId, method, path, `Response${code}Value`);
          returnType = `map[STRING]STRUCT(${responseStructName})`;
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
          const resolvedSchema = schema.$ref ? resolver.resolveRef(schema.$ref) : schema;
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

function extractErrors(op: any, _spec: any, resolver: RefResolver): any[] {
  const errors: any[] = [];

  // Extract error responses (4xx, 5xx)
  for (const [code, rawResponse] of Object.entries<any>(op.responses || {})) {
    const normalizedCode = code.toUpperCase();
    let statusCode = parseInt(code);
    
    if (normalizedCode.endsWith('XX')) {
      // Maps 4XX -> 400, 5XX -> 500
      statusCode = parseInt(normalizedCode.charAt(0)) * 100;
    }

    if (isNaN(statusCode) && code !== 'default') continue;

    if (statusCode >= 400 || code === 'default') {
      // Resolve $ref on the response object itself
      const response = rawResponse.$ref ? resolver.resolveRef(rawResponse.$ref) : rawResponse;
      const content = response.content;
      let errorType = TYPE_ANY;
      let when = `HTTP ${code}`;

      if (content) {
        const jsonContent = content[CONTENT_TYPE_JSON];
        if (jsonContent?.schema) {
          const schema = jsonContent.schema;
          if (schema.$ref) {
            errorType = getTypeFromSchema(schema, resolver);
          } else if (isStructSchema(schema)) {
            // Inline object error schema. Name it so extractStructs can
            // register the matching definition. Shared components.responses
            // entries get a stable name (Error{code} or Response_{key});
            // truly inline per-operation schemas get an operation-specific
            // name so two different 400 bodies don't collide on `Error400`.
            const errorStructName = getErrorStructName(rawResponse, op, code);
            errorType = `STRUCT(${errorStructName})`;
          } else {
            // Primitive / array error schema / non-struct object
            errorType = getTypeFromSchema(schema, resolver);
          }
        }
      }

      // Generate descriptive WHEN clause with HTTP status code
      when = generateErrorWhen(response, code);

      // v2.0.2: STATUS code is required in ERRORS
      const errorItem: any = {
        TYPE: errorType,
        STATUS: !isNaN(statusCode) ? statusCode : (code === 'default' ? 500 : 400),
        WHEN: when,
      };
      errors.push(errorItem);
    }
  }

  return errors;
}

function extractMethods(spec: any, resolver: RefResolver): Record<string, any> {
  const methods: Record<string, any> = {};
  
  // Valid HTTP methods
  const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
  
  // Combine paths and webhooks (OpenAPI 3.1)
  const pathLikeObjects: Array<{ pathStr: string, pathMethods: any, isWebhook: boolean }> = [];
  if (spec.paths && typeof spec.paths === 'object') {
    pathLikeObjects.push(...Object.entries<any>(spec.paths).map(([k, v]) => ({ pathStr: k, pathMethods: v, isWebhook: false })));
  }
  if (spec.webhooks && typeof spec.webhooks === 'object') {
    pathLikeObjects.push(...Object.entries<any>(spec.webhooks).map(([k, v]) => ({ pathStr: k, pathMethods: v, isWebhook: true })));
  }
  
  if (pathLikeObjects.length === 0) {
    return methods;
  }
  
  for (const { pathStr, pathMethods, isWebhook } of pathLikeObjects) {
    const pathLevelParams = pathMethods.parameters || [];
    
    for (const [method, op] of Object.entries<any>(pathMethods)) {
      // Skip extension fields (x-*) and only process valid HTTP methods
      if (method.startsWith('x-') || !validMethods.includes(method.toLowerCase())) {
        continue;
      }
      
      const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
      // Real-world specs sometimes reuse the same operationId across many
      // endpoints, even though OpenAPI requires operationId to be unique.
      // Key the intermediate map by method+path (always unique) so those
      // operations don't silently overwrite each other before CANONICAL_ID
      // renaming runs.
      const alias = `${method.toUpperCase()} ${pathStr}`;
      
      const summary = generateSummary(op, method, pathStr);
      const endpoint = pathStr;
      
      // Merge path-level and operation-level parameters (OpenAPI v3)
      const allParams = [...pathLevelParams, ...(op.parameters || [])];
      
      // Resolve request body early so HTTP metadata extraction sees it
      let resolvedRequestBody = op.requestBody;
      if (resolvedRequestBody && resolvedRequestBody.$ref) {
        resolvedRequestBody = resolver.resolveRef(resolvedRequestBody.$ref);
      }
      
      const opWithMergedParams = { ...op, parameters: allParams, requestBody: resolvedRequestBody };
      
      const { contentType, bodyType } = getContentTypeAndBodyType(opWithMergedParams);
      const headers = getHeadersForOperation(opWithMergedParams, spec, method, resolver);
      const pathQueryHeaderParams = extractParameters(opWithMergedParams, spec, resolver, operationId, method, pathStr);
      const bodyParams = extractRequestBody(opWithMergedParams, operationId, method, pathStr, spec, resolver);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(opWithMergedParams, operationId, method, pathStr, spec, resolver);
      const errors = extractErrors(opWithMergedParams, spec, resolver);

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
      
      // Add DEPRECATED if operation is deprecated
      if (op.deprecated === true) {
        methodDef.DEPRECATED = true;
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

      // Add SECURITY metadata
      const security = op.security !== undefined ? op.security : spec.security;
      if (security && Array.isArray(security)) {
        if (security.length === 0) {
          methodDef.SECURITY = [];
        } else {
          methodDef.SECURITY = security.map((req: any) => {
            const enrichedReq: any = {};
            for (const [schemeName, scopes] of Object.entries(req)) {
              const scheme = spec.components?.securitySchemes?.[schemeName];
              if (scheme) {
                enrichedReq[schemeName] = {
                  type: scheme.type,
                };
                if (scheme.scheme) enrichedReq[schemeName].scheme = scheme.scheme;
                if (scheme.in) enrichedReq[schemeName].in = scheme.in;
                if (scheme.name) enrichedReq[schemeName].name = scheme.name;
                
                const scopesArr = scopes as string[];
                if (scopesArr && scopesArr.length > 0) {
                  enrichedReq[schemeName].scopes = scopesArr;
                }
              } else {
                enrichedReq[schemeName] = { scopes };
              }
            }
            return enrichedReq;
          });
        }
      }

      // Determine Execution Mode
      let executionMode = EXECUTION_MODE_SYNC;
      if (isWebhook || op.callbacks) {
        executionMode = EXECUTION_MODE_ASYNC;
      } else if (op.responses) {
        for (const respCode of Object.keys(op.responses)) {
          if (respCode.startsWith('202')) {
            executionMode = EXECUTION_MODE_ASYNC;
            break;
          }
        }
      }

      // EXECUTION section (mandatory) - v2.0.2 requires KIND
      methodDef.EXECUTION = {
        KIND: 'http',
        MODE: executionMode,
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
    let key = canonicalId || oldId;
    key = key.replace(/-/g, '_');
    renamed[key] = methodData;
  }
  return renamed;
}


function generateWrekenfile(spec: any, baseDir: string): string {
  const resolver = new RefResolver(baseDir, spec);
  try {
    // Validate inputs
    validateOpenApiV3Spec(spec);
    validateBaseDir(baseDir);

    const defaults = extractSecurityDefaults(spec);
    const methods = extractMethods(spec, resolver);
    const structs = extractStructs(spec, resolver);

    // Resolve canonical IDs for all methods
    const canonicalInputs: MethodCanonicalInput[] = Object.entries(methods).map(
      ([methodId, methodData]) => ({
        methodId,
        httpMethod: methodData.HTTP?.METHOD,
        endpoint: methodData.HTTP?.ENDPOINT,
        existingCanonicalId: methodData.CANONICAL_ID,
      })
    );
    const libraryName = spec?.info?.['x-swytchcode-namespace'] || spec?.info?.title || 'unknown';
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
    const yaml = generateWrekenfile(spec, baseDir);
    const wrekenfile = load(yaml);
    const stats = computeConversionStats(wrekenfile);
    return { yaml, stats };
  } catch (err: any) {
    if (err.code && (err.code.startsWith('INVALID_') || err.code.startsWith('MISSING_'))) {
      throw err;
    }
    throw err;
  }
}



export { generateWrekenfile, generateWrekenfileWithStats };
