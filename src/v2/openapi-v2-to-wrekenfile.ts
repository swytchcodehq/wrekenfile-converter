// openapi-v2-swagger-to-wrekenfile-v2.ts
// Converts OpenAPI v2 (Swagger) specifications to Wrekenfile v2.0.1 format


import { load } from 'js-yaml';
import { generateYamlString } from './utils/yaml-utils';
import { 
  WREKENFILE_VERSION,
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
  AUTH_TEMPLATE_BEARER_ACCESS,
  AUTH_TEMPLATE_BASIC,
  HTTP_METHODS_WITH_BODY,
} from './utils/constants';
import { generateReturnVarName, generateErrorWhen } from './utils/response-utils';
import { generateOpenApiSummary } from './utils/summary-utils';
import { validateOpenApiV2Spec, validateBaseDir, logError, createConverterError } from './utils/error-utils';
import { resolveCanonicalIds, type MethodCanonicalInput } from './utils/canonical-id';
import { filterStructsByUsage } from './utils/struct-utils';
import { computeConversionStats, type ConversionStats } from './utils/conversion-stats';

import { RefResolver } from './utils/ref-utils';
import {
  extractStructs,
  getTypeFromSchema,
  generateStructName,
  getErrorStructName,
  isStructSchema,
  getSingleAllOfRef,
} from './utils/schema-utils';



// Re-export for backward compatibility

const generateSummary = generateOpenApiSummary;


function getContentTypeAndBodyType(op: any, spec: any): { contentType: string; bodyType: string } {
  // Check if there are formData parameters
  const hasFormData = op.parameters?.some((param: any) => param && typeof param === 'object' && param.in === 'formData');
  
  if (hasFormData) {
    return { contentType: CONTENT_TYPE_FORM_DATA, bodyType: 'form-data' };
  }
  
  // OpenAPI v2 determines content type from consumes array or defaults
  const consumes = op.consumes || spec.consumes || [CONTENT_TYPE_JSON];
  const contentType = consumes.includes(CONTENT_TYPE_JSON) ? CONTENT_TYPE_JSON : (consumes[0] || CONTENT_TYPE_JSON);
  
  let bodyType = BODYTYPE_RAW;
  if (contentType === CONTENT_TYPE_FORM_DATA) {
    bodyType = 'form-data';
  } else if (contentType === CONTENT_TYPE_URLENCODED) {
    bodyType = 'x-www-form-urlencoded';
  }

  return { contentType, bodyType };
}

function getAcceptContentType(op: any, spec: any): string {
  // Get the first content type from the first success response (2xx)
  for (const [code, _response] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    if (statusCode >= 200 && statusCode < 300) {
      // OpenAPI v2 uses produces array
      const produces = op.produces || spec.produces || [CONTENT_TYPE_JSON];
      if (produces.length > 0) {
        return produces.includes(CONTENT_TYPE_JSON) ? CONTENT_TYPE_JSON : produces[0];
      }
    }
  }
  // Default to JSON if no response content type found
  return CONTENT_TYPE_JSON;
}

function getHeadersForOperation(op: any, spec: any, method?: string, resolver?: RefResolver): Record<string, string> {
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
    for (const [schemeName, _scopes] of Object.entries(securityRequirement)) {
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

function extractParameters(op: any, _spec: any, resolver: RefResolver): any[] {
  const inputParams: any[] = [];
  
  // Handle query parameters only
  // Path parameters are already in ENDPOINT (e.g., /users/{userId})
  // Header parameters are in HTTP.HEADERS
  // Body and formData parameters are handled in extractRequestBody
  if (op.parameters) {
    for (let param of op.parameters) {
      // Resolve parameter references
      if (param && typeof param === 'object' && param.$ref) {
        param = resolver.resolveRef(param.$ref);
      }
      
      // Skip body and formData parameters, they are handled in extractRequestBody
      if (param && typeof param === 'object' && (param.in === 'body' || param.in === 'formData')) {
        continue;
      }
      
      const paramIn = param && typeof param === 'object' ? param.in || 'query' : 'query';
      
      // v2.0.2: All parameters (path, query, header) must be in INPUTS with LOCATION
      // Don't skip any - include all with LOCATION
      
      const paramName = param && typeof param === 'object' ? param.name : '';
      const paramSchema = param && typeof param === 'object' ? param.schema || {} : {};
      
      // Query parameters default to false if not specified
      const isRequired = param && typeof param === 'object' ? param.required === true : false;
      const hasDefault = paramSchema && typeof paramSchema === 'object' ? paramSchema.default !== undefined : false;
      
      let type = 'STRING';
      if (param && typeof param === 'object' && param.type) {
        type = getTypeFromSchema({ type: param.type, format: param.format }, resolver);
      } else if (paramSchema && typeof paramSchema === 'object' && paramSchema.type) {
        type = getTypeFromSchema(paramSchema, resolver);
      }
      
      // v2.0.2: All INPUTS must have LOCATION field
      // Build input parameter with LOCATION
      if (isRequired && !hasDefault) {
        // Simple form with LOCATION
        const inputParam: any = {};
        inputParam[paramName] = {
          TYPE: type,
          LOCATION: paramIn,
        };
        inputParams.push(inputParam);
      } else {
        // Extended form with LOCATION
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
  }
  
  return inputParams;
}

function extractRequestBody(op: any, operationId: string, method: string, path: string, _spec: any, resolver: RefResolver): any[] {
  const inputParams: any[] = [];
  
  // OpenAPI v2 uses parameters with in: body
  const bodyParam = (op.parameters || []).find((p: any) => p && typeof p === 'object' && p.in === 'body');

  if (bodyParam) {
    let type: string;
    if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema && (bodyParam.schema.$ref || getSingleAllOfRef(bodyParam.schema))) {
      type = getTypeFromSchema(bodyParam.schema, resolver);
    } else if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema && isStructSchema(bodyParam.schema)) {
      // Inline object schema - use generated struct name
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    } else if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema) {
      // Non-object inline schema (array, primitive, map) - no matching
      // STRUCTS entry will ever be registered for it, so don't wrap it in
      // a dangling STRUCT(...) reference.
      type = getTypeFromSchema(bodyParam.schema, resolver);
    } else {
      type = 'ANY';
    }
    
    // In OpenAPI v2, body parameters default to false (optional) if not specified
    const isRequired = bodyParam && typeof bodyParam === 'object' ? bodyParam.required === true : false;
    
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
  }
  
  // Handle formData for multipart/form-data (OpenAPI v2)
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param && typeof param === 'object' && param.in === 'formData') {
        const type = param.type === 'file' ? 'STRING' : getTypeFromSchema({ type: param.type, format: param.format, items: param.items }, resolver);
        // FormData parameters default to false (optional) if not specified
        const isRequired = param.required === true;
        const hasDefault = param.default !== undefined;
        
        const inputParam: any = {};
        // v2.0.2: All INPUTS must have LOCATION field
        if (isRequired && !hasDefault) {
          // Simple form with LOCATION
          inputParam[param.name] = {
            TYPE: type,
            LOCATION: 'body',
          };
        } else {
          // Extended form with LOCATION
          inputParam[param.name] = {
            TYPE: type,
            REQUIRED: isRequired,
            LOCATION: 'body',
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

function extractResponses(op: any, operationId: string, method: string, path: string, _spec: any, resolver: RefResolver): any[] {
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
      actualResponse = resolver.resolveRef(response.$ref);
    }
    
    let returnType: string | null = null;

    // 204 No Content - no response body
    if (code === '204') {
      continue;
    }

    if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
      const schema = actualResponse.schema;
      if (schema.$ref) {
        returnType = getTypeFromSchema(schema, resolver);
      } else if (schema.type === 'array') {
        if (schema.items?.$ref) {
          returnType = getTypeFromSchema(schema, resolver);
        } else {
          returnType = getTypeFromSchema(schema, resolver);
        }
      } else if (isStructSchema(schema)) {
        // Inline schema (object properties, possibly without an explicit
        // "type": "object" — common in real-world Swagger specs) - use
        // generated struct name so extractStructs' matching entry is kept.
        const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
        returnType = `STRUCT(${responseStructName})`;
      } else {
        returnType = getTypeFromSchema(schema, resolver);
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

      // v2.0.2: STATUS code is required in RETURNS
      const returnItem: any = {
        RETURNTYPE: returnType,
        RETURNVAR: returnVarName,
        STATUS: statusCode,
      };

      // Check for pagination hints in response schema
      if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
        const schema = actualResponse.schema;
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

      returns.push(returnItem);
    }
  }

  return returns;
}

function extractErrors(op: any, _spec: any, resolver: RefResolver): any[] {
  const errors: any[] = [];

  // Extract error responses (4xx, 5xx)
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    const statusCode = parseInt(code);
    if (isNaN(statusCode) && code !== 'default') continue;
    
    if (statusCode >= 400 || code === 'default') {
      // Handle response references
      let actualResponse = response;
      if (response && typeof response === 'object' && response.$ref) {
        actualResponse = resolver.resolveRef(response.$ref);
      }
      
      let errorType = TYPE_ANY;
      let when = `HTTP ${code}`;

      if (actualResponse && typeof actualResponse === 'object' && actualResponse.schema) {
        const schema = actualResponse.schema;
        if (schema.$ref) {
          errorType = getTypeFromSchema(schema, resolver);
        } else if (schema.type && schema.type !== 'object') {
          // Primitive / array error schema — emit the primitive type directly
          // instead of wrapping in a dangling STRUCT(...).
          errorType = getTypeFromSchema(schema, resolver);
        } else {
          // Inline object error schema — generate a struct name. Shared
          // Swagger v2 responses (spec.responses.X) get a stable name so the
          // corresponding struct registered by extractStructs is the same one
          // extractErrors references.
          const errorStructName = getErrorStructName(response, op, code);
          errorType = `STRUCT(${errorStructName})`;
        }
      }

      // Generate descriptive WHEN clause with HTTP status code
      when = generateErrorWhen(actualResponse, code);

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

function extractMethods(spec: any, resolver: RefResolver): Record<string, any> {
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
      // Real-world specs sometimes reuse the same operationId across many
      // endpoints (e.g. generic "CreateIndividual" CRUD ids repeated per
      // resource), even though OpenAPI requires operationId to be unique.
      // Key the intermediate map by method+path (always unique) so those
      // operations don't silently overwrite each other before CANONICAL_ID
      // renaming runs.
      const alias = `${method.toUpperCase()} ${pathStr}`;
      
      const summary = generateSummary(op, method, pathStr);
      const endpoint = pathStr;
      
      // Merge path-level and operation-level parameters
      const allParams = [...pathLevelParams, ...(op.parameters || [])];
      const opWithMergedParams = { ...op, parameters: allParams };
      
      const { contentType, bodyType } = getContentTypeAndBodyType(opWithMergedParams, spec);
      const headers = getHeadersForOperation(opWithMergedParams, spec, method, resolver);
      const pathQueryHeaderParams = extractParameters(opWithMergedParams, spec, resolver);
      const bodyParams = extractRequestBody(opWithMergedParams, operationId, method, pathStr, spec, resolver);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(opWithMergedParams, operationId, method, pathStr, spec, resolver);
      const errors = extractErrors(opWithMergedParams, spec, resolver);

      // Get accept content type from responses
      const acceptContentType = getAcceptContentType(opWithMergedParams, spec);

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
  const securityDefinitions = spec.securityDefinitions || {}; // OpenAPI v2 uses securityDefinitions
  
  for (const [_name, scheme] of Object.entries<any>(securityDefinitions)) {
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

function preprocessFormDataParameters(spec: any) {
  if (!spec.paths || typeof spec.paths !== 'object') return;
  const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
  
  for (const pathMethods of Object.values<any>(spec.paths)) {
    const pathLevelParams = pathMethods.parameters || [];
    
    for (const [method, op] of Object.entries<any>(pathMethods)) {
      if (!validMethods.includes(method.toLowerCase()) || !op || typeof op !== 'object') continue;
      
      const opParams = op.parameters || [];
      
      // Resolve parameters: operation overrides path
      const mergedParamsMap = new Map();
      for (const p of pathLevelParams) {
        if (p && typeof p === 'object' && p.name && p.in) {
          mergedParamsMap.set(`${p.name}-${p.in}`, p);
        }
      }
      for (const p of opParams) {
        if (p && typeof p === 'object' && p.name && p.in) {
          mergedParamsMap.set(`${p.name}-${p.in}`, p);
        }
      }
      let allParams = Array.from(mergedParamsMap.values());
      
      const consumes = op.consumes || spec.consumes || [CONTENT_TYPE_JSON];
      if (consumes.includes(CONTENT_TYPE_JSON)) {
        const formDataParams = allParams.filter((p: any) => p.in === 'formData');
        const bodyParam = allParams.find((p: any) => p.in === 'body');
        
        if (formDataParams.length > 0 && !bodyParam) {
          // Convert formData params into a single body param with a schema
          const schemaProperties: any = {};
          const requiredProps: string[] = [];
          
          for (const param of formDataParams) {
            schemaProperties[param.name] = {
              type: param.type || 'string',
            };
            if (param.description) schemaProperties[param.name].description = param.description;
            if (param.format) schemaProperties[param.name].format = param.format;
            if (param.default !== undefined) schemaProperties[param.name].default = param.default;
            if (param.required) requiredProps.push(param.name);
            
            // CodeRabbit Fix: Include items for array types
            if (param.type === 'array' && param.items) {
              schemaProperties[param.name].items = param.items;
            }
          }
          
          const newBodyParam: any = {
            in: 'body',
            name: 'body',
            description: 'Synthetic body parameter created from formData fields',
            required: requiredProps.length > 0,
            schema: {
              type: 'object',
              properties: schemaProperties
            }
          };
          if (requiredProps.length > 0) {
            newBodyParam.schema.required = requiredProps;
          }
          
          // Remove formData params and add the new body param
          allParams = allParams.filter((p: any) => p.in !== 'formData');
          allParams.push(newBodyParam);
        }
      }
      
      // Update op.parameters with the resolved params
      op.parameters = allParams;
    }
    
    // Clear path-level parameters so they aren't duplicated by subsequent logic
    delete pathMethods.parameters;
  }
}

function generateWrekenfile(specStr: string | any, baseDir: string): string {
  let spec: any = {};
  try {
    const parsed = typeof specStr === 'string' ? (specStr.trim().startsWith('{') ? JSON.parse(specStr) : load(specStr)) : specStr;
    spec = JSON.parse(JSON.stringify(parsed));
    const resolver = new RefResolver(baseDir, spec);

    // Validate inputs
    validateOpenApiV2Spec(spec);
    validateBaseDir(baseDir);

    // Preprocess formData parameters into structural bodies for JSON-supporting endpoints
    preprocessFormDataParameters(spec);

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
      converter: 'openapi-v2-to-wrekenfile',
      baseDir,
      specInfo: spec?.info?.title || 'unknown',
      specVersion: spec?.swagger || 'unknown'
    });
    
    // Re-throw with additional context if it's not already a ConverterError
    if (err.code && (err.code.startsWith('INVALID_') || err.code.startsWith('MISSING_'))) {
      throw err;
    }
    
    throw createConverterError(
      `Failed to generate Wrekenfile from OpenAPI v2 spec: ${err.message}`,
      "GENERATION_FAILED",
      {
        converter: 'openapi-v2-to-wrekenfile',
        baseDir,
        specInfo: spec?.info?.title || 'unknown',
        specVersion: spec?.swagger || 'unknown'
      },
      err
    );
  }
}

/**
 * Generate a Wrekenfile and return both the YAML string and conversion stats.
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

// Export for programmatic use
export { generateWrekenfile, generateWrekenfileWithStats };

