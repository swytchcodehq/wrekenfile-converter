// openapi-to-wreken.ts
import * as fs from 'fs';
import * as path from 'path';
import { load, dump } from 'js-yaml';
import { load as yamlLoad } from 'js-yaml';

type Primitive = 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'DATE' | 'ANY' | 'UUID';
const externalRefCache: Record<string, any> = {};

function mapType(type: any, format?: string): Primitive {
  if (format === 'uuid') return 'UUID';
  if (format === 'date-time') return 'TIMESTAMP';
  if (format === 'binary') return 'STRING'; // File uploads
  if (typeof type === 'string') {
    const t = type.toLowerCase();
    if (t === 'string') return 'STRING';
    if (t === 'integer' || t === 'int') return 'INT';
    if (t === 'number') return 'FLOAT';
    if (t === 'boolean') return 'BOOL';
    return 'ANY';
  }
  // Handle array of types (OpenAPI allows type: ['string', 'null'])
  if (Array.isArray(type) && type.length > 0 && typeof type[0] === 'string') {
    const t = type[0].toLowerCase();
  if (t === 'string') return 'STRING';
  if (t === 'integer' || t === 'int') return 'INT';
  if (t === 'number') return 'FLOAT';
  if (t === 'boolean') return 'BOOL';
    return 'ANY';
  }
  // Fallback for missing or unexpected type
  return 'ANY';
}

function generateDesc(op: any, method: string, path: string): string {
  if (op.summary) return op.summary;
  if (op.description) return op.description;
  if (op.operationId) return `Perform operation ${op.operationId}`;
  const verb = {
    get: 'Fetch',
    post: 'Create',
    put: 'Update',
    delete: 'Delete',
    patch: 'Modify',
  }[method.toLowerCase()] || 'Call';
  const entity = path.split('/').filter(p => p && !p.startsWith('{')).pop() || 'resource';
  return `${verb} ${entity}`;
}

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
      required: 'OPTIONAL'
    }];
  }

  // Handle primitive types - return empty array (no struct needed)
  if (schema && typeof schema === 'object' && schema.type && schema.type !== 'object' && schema.type !== 'array') {
    return [];
  }

  // Handle empty objects (no properties) - return empty array
  if (schema && typeof schema === 'object' && schema.type === 'object' && (!schema.properties || Object.keys(schema.properties).length === 0)) {
    return [];
  }

  const fields: any[] = [];

  if (schema && typeof schema === 'object' && schema.discriminator?.propertyName) {
    fields.push({
      name: schema.discriminator.propertyName,
      type: 'STRING',
      required: 'REQUIRED',
    });
  }

  if (schema && typeof schema === 'object' && schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      let type = 'ANY';
      if (prop && typeof prop === 'object' && prop.$ref) {
        type = `STRUCT(${prop.$ref.split('/').pop()})`;
      } else if (prop && typeof prop === 'object' && prop.type === 'array') {
        if (prop && typeof prop === 'object' && prop.items && prop.items.$ref) {
          type = `[]STRUCT(${prop.items.$ref.split('/').pop()})`;
        } else if (prop && typeof prop === 'object' && prop.items) {
          type = `[]${mapType(prop.items?.type)}`;
        }
      } else {
        type = mapType(prop.type, prop.format);
      }
      
      // Use the required field from the OpenAPI spec
      const required = (schema.required || []).includes(key) ? 'REQUIRED' : 'OPTIONAL';
      
      fields.push({
        name: key,
        type,
        required,
      });
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
  const definitions = spec.definitions || {};
  
  // Extract schemas from definitions (OpenAPI v2 equivalent of components.schemas)
  for (const name in definitions) {
    const fields = parseSchema(name, definitions[name], spec, baseDir);
    // Always add the struct, even if empty
    structs[name] = fields;
    if (definitions[name] && typeof definitions[name] === 'object' && (definitions[name].oneOf || definitions[name].anyOf)) {
      structs[`${name}_Union`] = [{ name: 'value', type: 'ANY', required: 'OPTIONAL' }];
    }
  }
  
  // Extract inline schemas from operations
  for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(methods)) {
      const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
      
      // Extract request body schemas (OpenAPI v2 uses parameters with in: body)
      if (op.parameters) {
        for (const param of op.parameters) {
          if (param && typeof param === 'object' && param.in === 'body' && param.schema && !param.schema.$ref) {
            // Inline schema - create a struct for it only if it has fields
            const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
            const fields = parseSchema(requestStructName, param.schema, spec, baseDir);
            if (fields.length > 0) {
              structs[requestStructName] = fields;
            }
          }
        }
      }
      
      // Extract response schemas (OpenAPI v2 has schema directly in response)
      if (op.responses) {
        for (const [code, response] of Object.entries<any>(op.responses)) {
          if (response && typeof response === 'object' && response.schema && !response.schema.$ref) {
            // Inline schema - create a struct for it only if it has fields
            const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}`);
            const fields = parseSchema(responseStructName, response.schema, spec, baseDir);
            if (fields.length > 0) {
              structs[responseStructName] = fields;
            }
          }
        }
      }
    }
  }
  
  return structs;
}

function getContentTypeAndBodyType(op: any): { contentType: string; bodyType: string } {
  // Check if there are formData parameters
  const hasFormData = op.parameters?.some((param: any) => param && typeof param === 'object' && param.in === 'formData');
  
  if (hasFormData) {
    return { contentType: 'multipart/form-data', bodyType: 'FORM' };
  }
  
  // OpenAPI v2 determines content type from consumes array or defaults
  const consumes = op.consumes || ['application/json'];
  const contentType = consumes[0] || 'application/json';
  
  let bodyType = 'RAW';
  if (contentType === 'multipart/form-data') {
    bodyType = 'FORM';
  } else if (contentType === 'application/x-www-form-urlencoded') {
    bodyType = 'FORM';
  } else if (contentType === 'application/json') {
    bodyType = 'JSON';
  }

  return { contentType, bodyType };
}

function getHeadersForOperation(op: any, spec: any): Record<string, string>[] {
  const { contentType } = getContentTypeAndBodyType(op);
  
  // Use a Map to prevent duplicate headers
  const headerMap = new Map<string, string>();
  const cookieMap = new Map<string, string>();
  
  // Add Content-Type header
  headerMap.set('Content-Type', contentType);
  
  // Add security headers based on the operation's security requirements
  const security = op.security || spec.security || [];
  
  for (const securityRequirement of security) {
    for (const [schemeName, _scopes] of Object.entries(securityRequirement)) {
      const scheme = spec.securityDefinitions?.[schemeName];
      if (scheme) {
        if (scheme.type === 'basic') {
          headerMap.set('Authorization', 'basic_auth');
        } else if (scheme.type === 'apiKey') {
          if (scheme.in === 'header') {
            headerMap.set(scheme.name, `<${scheme.name.toUpperCase()}>`);
          } else if (scheme.in === 'query') {
            // Query parameters are handled in extractParameters
          } else if (scheme.in === 'cookie') {
            cookieMap.set(scheme.name, `<${scheme.name.toUpperCase()}>`);
          }
        } else if (scheme.type === 'oauth2') {
          headerMap.set('Authorization', 'bearer_token');
        }
      }
    }
  }
  
  // Check if Authorization is used as a parameter but not defined in securityDefinitions
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param && typeof param === 'object' && param.in === 'header' && param.name === 'Authorization' && !headerMap.has('Authorization')) {
        headerMap.set('Authorization', 'bearer_token');
      }
    }
  }
  
  // Convert maps to arrays
  const headers: Record<string, string>[] = [];
  for (const [key, value] of headerMap) {
    headers.push({ [key]: value });
  }
  for (const [key, value] of cookieMap) {
    headers.push({ [`Cookie-${key}`]: value });
  }
  
  return headers;
}

function extractParameters(op: any, spec: any): any[] {
  const inputParams: any[] = [];
  
  // Handle path, query, and header parameters
  if (op.parameters) {
    for (let param of op.parameters) {
      // Resolve parameter references
      if (param && typeof param === 'object' && param.$ref) {
        if (!spec.swaggerFile) {
          throw new Error("spec.swaggerFile is undefined. Please provide a valid baseDir when calling generateWrekenfile, or ensure all refs are internal.");
        }
        param = resolveRef(param.$ref, spec, path.dirname(spec.swaggerFile));
      }
      
      // Skip body and formData parameters, they are handled in extractRequestBody
      if (param && typeof param === 'object' && (param.in === 'body' || param.in === 'formData')) {
        continue;
      }
      
      const paramType = param && typeof param === 'object' ? param.in || 'query' : 'query';
      const paramName = param && typeof param === 'object' ? param.name : '';
      const paramSchema = param && typeof param === 'object' ? param.schema || {} : {}; // Schema is sometimes at root of param
      const paramRequired = param && typeof param === 'object' ? param.required ? 'REQUIRED' : 'OPTIONAL' : 'OPTIONAL';
      
      let type = 'STRING';
      if (param && typeof param === 'object' && param.type) {
        type = mapType(param.type, param.format);
      } else if (paramSchema && typeof paramSchema === 'object' && paramSchema.type) {
        type = mapType(paramSchema.type, paramSchema.format);
      }
      
      inputParams.push({
        name: paramName,
        type,
        required: paramRequired,
        location: paramType.toUpperCase(), // PATH, QUERY, HEADER
      });
    }
  }
  
  return inputParams;
}

function extractRequestBody(op: any, operationId: string, method: string, path: string): any[] {
  const inputParams: any[] = [];
  const bodyParam = (op.parameters || []).find((p: any) => p && typeof p === 'object' && p.in === 'body');

  if (bodyParam) {
    let type: string;
    if (bodyParam && typeof bodyParam === 'object' && bodyParam.schema?.$ref) {
      type = `STRUCT(${bodyParam.schema.$ref.split('/').pop()})`;
    } else {
      // Inline schema - use generated struct name
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    }
    inputParams.push({
      name: 'body',
      type,
      required: bodyParam && typeof bodyParam === 'object' ? bodyParam.required ? 'REQUIRED' : 'OPTIONAL' : 'OPTIONAL',
    });
  }
  
  // Handle formData for multipart/form-data
  if (op.parameters) {
    for (const param of op.parameters) {
      if (param && typeof param === 'object' && param.in === 'formData') {
        inputParams.push({
          name: param && typeof param === 'object' ? param.name : '',
          type: param && typeof param === 'object' ? param.type === 'file' ? 'FILE' : mapType(param.type, param.format) : 'STRING',
          required: param && typeof param === 'object' ? param.required ? 'REQUIRED' : 'OPTIONAL' : 'OPTIONAL',
        });
      }
    }
  }

  return inputParams;
}

function extractResponses(op: any, operationId: string, method: string, path: string): any[] {
  const returns: any[] = [];

  // Handle all response codes (success and error)
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    let returnType = 'ANY';
    if (response && typeof response === 'object' && response.schema) {
      if (response && typeof response === 'object' && response.schema.$ref) {
        returnType = `STRUCT(${response.schema.$ref.split('/').pop()})`;
      } else if (response && typeof response === 'object' && response.schema.type === 'array') {
        if (response && typeof response === 'object' && response.schema.items?.$ref) {
          returnType = `[]STRUCT(${response.schema.items.$ref.split('/').pop()})`;
        } else if (response && typeof response === 'object' && response.schema.items) {
          returnType = `[]${mapType(response.schema.items?.type)}`;
        }
      } else if (response && typeof response === 'object' && response.schema.type === 'object') {
        // Inline schema - use generated struct name
        const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
        returnType = `STRUCT(${responseStructName})`;
      }
    } else if (code === '204' || response && typeof response === 'object' && response.description === 'No Content') {
      returnType = 'VOID';
    }

    returns.push({
      RETURNTYPE: returnType,
      RETURNNAME: 'response',
      CODE: code === 'default' ? '500' : code,
    });
  }

  return returns;
}

function extractInterfaces(spec: any): Record<string, any> {
  const base = `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}`;
  const interfaces: Record<string, any> = {};
  
  // Valid HTTP methods
  const validMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
  
  for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(methods)) {
      // Skip extension fields (x-*) and only process valid HTTP methods
      if (method.startsWith('x-') || !validMethods.includes(method.toLowerCase())) {
        continue;
      }
      
      const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
      const alias = operationId;
      const endpoint = pathStr.includes('{') ? `\`${base}${pathStr}\`` : `${base}${pathStr}`;
      
      // Check if operation is hidden from docs
      const isPrivate = op && typeof op === 'object' && op['x-hidden-from-docs'] === true;
      const visibility = isPrivate ? 'PRIVATE' : 'PUBLIC';
      
      const { bodyType } = getContentTypeAndBodyType(op);
      const headers = getHeadersForOperation(op, spec);
      const pathQueryHeaderParams = extractParameters(op, spec);
      const bodyParams = extractRequestBody(op, operationId, method, pathStr);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(op, operationId, method, pathStr);

      interfaces[alias] = {
        SUMMARY: op.summary || '',
        DESC: generateDesc(op, method, pathStr),
        TAGS: Array.isArray(op.tags) ? op.tags : [],
        ENDPOINT: endpoint,
        VISIBILITY: visibility,
        HTTP: {
          METHOD: method.toUpperCase(),
          HEADERS: headers,
          BODYTYPE: bodyType,
        },
        INPUTS: inputParams,
        RETURNS: returns,
      };
    }
  }
  return interfaces;
}

function extractSecurityDefaults(spec: any): any[] {
  const defs: any[] = [];
  const securityDefinitions = spec.securityDefinitions || {};
  
  for (const [_name, scheme] of Object.entries<any>(securityDefinitions)) {
    if (scheme && typeof scheme === 'object' && scheme.type === 'basic') {
      defs.push({ basic_auth: 'Basic <BASE64>' });
    } else if (scheme && typeof scheme === 'object' && scheme.type === 'apiKey') {
      if (scheme && typeof scheme === 'object' && scheme.in === 'header') {
        defs.push({ [scheme.name.toLowerCase()]: `<${scheme.name.toUpperCase()}>` });
      } else if (scheme && typeof scheme === 'object' && scheme.in === 'query') {
        defs.push({ [`query_${scheme.name.toLowerCase()}`]: `<${scheme.name.toUpperCase()}>` });
      }
    } else if (scheme && typeof scheme === 'object' && scheme.type === 'oauth2') {
      defs.push({ bearer_token: 'BEARER <ACCESS_TOKEN>' });
    }
  }
  
  return defs;
}

function cleanYaml(yamlString: string): string {
  return yamlString
    .replace(/\t/g, '  ')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\r\n/g, '\n');
}

function checkYamlForHiddenChars(yamlString: string): void {
  const lines = yamlString.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\t/.test(line)) {
      throw new Error(`YAML contains a TAB character at line ${i + 1}:\n${line}`);
    }
    if (/\u00A0/.test(line)) {
      throw new Error(`YAML contains a non-breaking space (U+00A0) at line ${i + 1}:\n${line}`);
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(line)) {
      throw new Error(`YAML contains a non-printable character at line ${i + 1}:\n${line}`);
    }
  }
}

function validateYaml(yamlString: string): void {
  try {
    yamlLoad(yamlString);
  } catch (e) {
    throw new Error('Generated YAML is invalid: ' + (e as any).message);
  }
}

function generateWrekenfile(spec: any, baseDir: string): string {
  if (!spec || typeof spec !== 'object') {
    throw new Error("Argument 'spec' is required and must be an object");
  }
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error("Argument 'baseDir' is required and must be a string");
  }
  // Add swaggerFile path to spec for ref resolution
  spec.swaggerFile = baseDir;

  let yamlString = dump({
    VERSION: '1.2',
    INIT: {
      DEFAULTS: [
        ...extractSecurityDefaults(spec),
        { w_base_url: `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}` },
      ],
    },
    INTERFACES: extractInterfaces(spec),
    STRUCTS: extractStructs(spec, baseDir),
  }, { noArrayIndent: true });
  yamlString = cleanYaml(yamlString);
  checkYamlForHiddenChars(yamlString);
  validateYaml(yamlString);
  return yamlString;
}

// Export for programmatic use
export { generateWrekenfile };
 