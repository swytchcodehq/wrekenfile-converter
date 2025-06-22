// openapi-to-wreken.ts
import * as fs from 'fs';
import * as path from 'path';
import { load, dump } from 'js-yaml';

type Primitive = 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'DATE' | 'ANY' | 'UUID';
const externalRefCache: Record<string, any> = {};

function mapType(type: string, format?: string): Primitive {
  if (format === 'uuid') return 'UUID';
  if (format === 'date-time') return 'TIMESTAMP';
  if (format === 'binary') return 'STRING'; // File uploads
  const t = type?.toLowerCase();
  if (t === 'string') return 'STRING';
  if (t === 'integer' || t === 'int') return 'INT';
  if (t === 'number') return 'FLOAT';
  if (t === 'boolean') return 'BOOL';
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

function getTypeFromSchema(schema: any, spec: any, baseDir: string): string {
  if (schema.$ref) {
    const resolvedSchema = resolveRef(schema.$ref, spec, baseDir);
    // Check if the resolved schema is a simple type
    if (resolvedSchema.type && resolvedSchema.type !== 'object') {
      return mapType(resolvedSchema.type, resolvedSchema.format);
    }
    // It's a complex type, use STRUCT
    return `STRUCT(${schema.$ref.split('/').pop()})`;
  }
  
  if (schema.type === 'array') {
    if (schema.items?.$ref) {
      const resolvedItems = resolveRef(schema.items.$ref, spec, baseDir);
      if (resolvedItems.type && resolvedItems.type !== 'object') {
        return `[]${mapType(resolvedItems.type, resolvedItems.format)}`;
      }
      return `[]STRUCT(${schema.items.$ref.split('/').pop()})`;
    } else {
      return `[]${mapType(schema.items?.type)}`;
    }
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
    return [{
      name: 'variant',
      type: `STRUCT(${name}_Union)`,
      required: 'FALSE'
    }];
  }

  const fields: any[] = [];

  if (schema.discriminator?.propertyName) {
    fields.push({
      name: schema.discriminator.propertyName,
      type: 'STRING',
      required: 'TRUE',
    });
  }

  // Handle simple types (string, integer, etc.) - these should not create structs
  if (schema.type && schema.type !== 'object') {
    // For simple types, return empty array to indicate no struct fields
    // The type will be used directly as a primitive
    return [];
  }

  if (schema.type === 'object' && schema.properties) {
    for (const [key, prop] of Object.entries<any>(schema.properties)) {
      const type = getTypeFromSchema(prop, spec, baseDir);
      
      // Use the required field from the OpenAPI spec
      const required = (schema.required || []).includes(key) ? 'TRUE' : 'FALSE';
      
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
  const schemas = spec.components?.schemas || {};
  
  // Extract schemas from components
  for (const name in schemas) {
    const schema = schemas[name];
    const fields = parseSchema(name, schema, spec, baseDir);
    // Always add the struct, even if empty
    structs[name] = fields;
    if (schema.oneOf || schema.anyOf) {
      structs[`${name}_Union`] = [{ name: 'value', type: 'ANY', required: 'FALSE' }];
    }
  }
  
  // Extract inline schemas from operations
  for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
    for (const [method, op] of Object.entries<any>(methods)) {
      const operationId = op.operationId || `${method}-${pathStr.replace(/[\/{}]/g, '-')}`;
      
      // Extract request body schemas
      if (op.requestBody?.content) {
        for (const [contentType, content] of Object.entries<any>(op.requestBody.content)) {
          if (content.schema && !content.schema.$ref) {
            // Inline schema - create a struct for it
            const requestStructName = generateStructName(operationId, method, pathStr, 'Request');
            const fields = parseSchema(requestStructName, content.schema, spec, baseDir);
            if (fields.length > 0) {
              structs[requestStructName] = fields;
            }
          }
        }
      }
      
      // Extract response schemas
      if (op.responses) {
        for (const [code, response] of Object.entries<any>(op.responses)) {
          if (response.content) {
            for (const [contentType, content] of Object.entries<any>(response.content)) {
              if (content.schema && !content.schema.$ref) {
                // Inline schema - create a struct for it
                const responseStructName = generateStructName(operationId, method, pathStr, `Response${code}`);
                const fields = parseSchema(responseStructName, content.schema, spec, baseDir);
                if (fields.length > 0) {
                  structs[responseStructName] = fields;
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
    return { contentType: 'application/json', bodyType: 'RAW' };
  }

  const contentTypes = Object.keys(requestBody.content);
  const contentType = contentTypes[0] || 'application/json';
  
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
    for (const [schemeName, scopes] of Object.entries(securityRequirement)) {
      const scheme = spec.components?.securitySchemes?.[schemeName];
      if (scheme) {
        if (scheme.type === 'http') {
          if (scheme.scheme === 'bearer') {
            headerMap.set('Authorization', 'bearer_token');
          } else if (scheme.scheme === 'basic') {
            headerMap.set('Authorization', 'basic_auth');
          } else if (scheme.scheme === 'digest') {
            headerMap.set('Authorization', 'digest_auth');
          } else {
            // Unknown HTTP auth scheme
            headerMap.set('Authorization', `<${scheme.scheme}_auth>`);
          }
        } else if (scheme.type === 'apiKey') {
          if (scheme.in === 'header') {
            headerMap.set(scheme.name, scheme.name.toLowerCase());
          } else if (scheme.in === 'query') {
            // Query params are not headers, but we can note them for completeness
            // (Wrekenfile may not support query auth directly in HEADERS)
            headerMap.set(`[QUERY] ${scheme.name}`, scheme.name.toLowerCase());
          } else if (scheme.in === 'cookie') {
            cookieMap.set(scheme.name, `<${scheme.name.toUpperCase()}>`);
          }
        } else if (scheme.type === 'oauth2') {
          headerMap.set('Authorization', 'bearer_token');
        } else if (scheme.type === 'openIdConnect') {
          headerMap.set('Authorization', 'id_token');
        }
      }
    }
  }
  
  // Convert Map back to array of objects
  const headers: Record<string, string>[] = [];
  for (const [key, value] of headerMap.entries()) {
    headers.push({ [key]: value });
  }
  // Add cookies as a special header if present
  if (cookieMap.size > 0) {
    const cookieHeader = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    headers.push({ Cookie: cookieHeader });
  }
  
  return headers;
}

function extractParameters(op: any, spec: any, baseDir: string): any[] {
  const inputParams: any[] = [];
  
  // Handle path, query, and header parameters
  for (let param of op.parameters || []) {
    // Resolve $ref if present
    if (param.$ref) {
      param = resolveRef(param.$ref, spec, baseDir);
    }

    const paramType = param.in || 'query';
    const paramName = param.name;
    const paramSchema = param.schema || {};
    const paramRequired = param.required ? 'TRUE' : 'FALSE';
    
    let type = 'STRING';
    if (paramSchema.type) {
      type = mapType(paramSchema.type, paramSchema.format);
    }
    
    inputParams.push({
      name: paramName,
      type,
      required: paramRequired,
      location: paramType.toUpperCase(), // PATH, QUERY, HEADER
    });
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
  
  if (contentType === 'application/json' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    let type: string;

    if (bodySchema.$ref) {
      type = getTypeFromSchema(bodySchema, spec, baseDir);
    } else {
      const requestStructName = generateStructName(operationId, method, path, 'Request');
      type = `STRUCT(${requestStructName})`;
    }
    
    inputParams.push({
      name: 'body',
      type,
      required: requestBody.required ? 'TRUE' : 'FALSE',
    });

  } else if (contentType === 'multipart/form-data' && requestBody.content[contentType]?.schema) {
    const bodySchema = requestBody.content[contentType].schema;
    if (bodySchema.properties) {
      for (const [key, prop] of Object.entries<any>(bodySchema.properties)) {
        const type = prop.format === 'binary' ? 'FILE' : getTypeFromSchema(prop, spec, baseDir);
        const required = (bodySchema.required || []).includes(key) ? 'TRUE' : 'FALSE';
        inputParams.push({
          name: key,
          type,
          required,
        });
      }
    }
  }
  
  return inputParams;
}

function extractResponses(op: any, operationId: string, method: string, path: string, spec: any, baseDir: string): any[] {
  const returns: any[] = [];

  // Handle all response codes (success and error)
  for (const [code, response] of Object.entries<any>(op.responses || {})) {
    const content = response.content;
    let returnType = 'ANY';

    if (content) {
      const jsonContent = content['application/json'];
      if (jsonContent?.schema) {
        const schema = jsonContent.schema;
        if (schema.$ref) {
          returnType = getTypeFromSchema(schema, spec, baseDir);
        } else {
          // It's an inline schema, so we need to generate a struct name for it
          const responseStructName = generateStructName(operationId, method, path, `Response${code}`);
          returnType = `STRUCT(${responseStructName})`;
        }
      }
    } else if (code === '204') {
      // 204 No Content - no response body
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

function extractInterfaces(spec: any, baseDir: string): Record<string, any> {
  const base = spec.servers?.[0]?.url || '';
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
      const isPrivate = op['x-hidden-from-docs'] === true;
      const visibility = isPrivate ? 'PRIVATE' : 'PUBLIC';
      
      const { bodyType } = getContentTypeAndBodyType(op);
      const headers = getHeadersForOperation(op, spec);
      const pathQueryHeaderParams = extractParameters(op, spec, baseDir);
      const bodyParams = extractRequestBody(op, operationId, method, pathStr, spec, baseDir);
      const inputParams = [...pathQueryHeaderParams, ...bodyParams];
      const returns = extractResponses(op, operationId, method, pathStr, spec, baseDir);

      interfaces[alias] = {
        DESC: generateDesc(op, method, pathStr),
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
  const securitySchemes = spec.components?.securitySchemes || {};
  
  for (const [name, scheme] of Object.entries<any>(securitySchemes)) {
    if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
      defs.push({ bearer_token: 'BEARER <TOKEN>' });
      } else if (scheme.scheme === 'basic') {
        defs.push({ basic_auth: 'Basic <BASE64>' });
      } else if (scheme.scheme === 'digest') {
        defs.push({ digest_auth: 'Digest <CREDENTIALS>' });
      } else {
        defs.push({ [`${scheme.scheme}_auth`]: `<${scheme.scheme.toUpperCase()}_CREDENTIALS>` });
      }
    } else if (scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        defs.push({ [scheme.name.toLowerCase()]: `<${scheme.name.toUpperCase()}>` });
      } else if (scheme.in === 'query') {
        defs.push({ [`query_${scheme.name.toLowerCase()}`]: `<${scheme.name.toUpperCase()}>` });
      } else if (scheme.in === 'cookie') {
        defs.push({ [`cookie_${scheme.name.toLowerCase()}`]: `<${scheme.name.toUpperCase()}>` });
      }
    } else if (scheme.type === 'oauth2') {
      defs.push({ bearer_token: 'BEARER <ACCESS_TOKEN>' });
    } else if (scheme.type === 'openIdConnect') {
      defs.push({ id_token: 'ID_TOKEN <JWT>' });
    }
  }
  
  return defs;
}

function generateWrekenfile(spec: any, baseDir: string): string {
  return dump({
    VERSION: '1.2',
    INIT: {
      DEFAULTS: [
        ...extractSecurityDefaults(spec),
        { w_base_url: spec.servers?.[0]?.url || 'https://api.default.com' },
      ],
    },
    INTERFACES: extractInterfaces(spec, baseDir),
    STRUCTS: extractStructs(spec, baseDir),
  });
}

// MAIN
const inputFile = process.argv[2];
const baseDir = path.dirname(inputFile);
const openapi = load(fs.readFileSync(inputFile, 'utf8'));
const output = generateWrekenfile(openapi, baseDir);
fs.writeFileSync('./Wrekenfile.yaml', output);
console.log('✅ Wrekenfile generated at ./Wrekenfile.yaml');

// Export for programmatic use
export { generateWrekenfile };
