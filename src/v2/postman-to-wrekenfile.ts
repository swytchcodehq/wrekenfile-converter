// postman-to-wrekenfile.ts
// Converts Postman collections to Wrekenfile v2.0.1 format
import * as fs from 'fs';
import * as path from 'path';
import { dump } from 'js-yaml';
import { cleanYaml, checkYamlForHiddenChars, validateYaml, removeTypeQuotes } from './utils/yaml-utils';
import { 
  WREKENFILE_VERSION, 
  DEFAULT_BASE_URL, 
  BASE_URL_VARIABLE_NAMES, 
  SENSITIVE_KEYS, 
  YAML_DUMP_OPTIONS,
  EXECUTION_MODE_ASYNC,
  ASYNC_RETURNS_RESULT,
  TYPE_VOID,
  BODYTYPE_RAW,
} from './utils/constants';
import { generateReturnVarName, generateErrorWhen } from './utils/response-utils';

type Primitive = 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'DATE' | 'TIME' | 'NULL' | 'UNDEFINED' | 'VOID' | 'ANY' | 'OBJECT';

function mapType(value: any): Primitive {
  if (typeof value === 'string') {
    // Check for common patterns
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'DATE';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'STRING'; // UUID as string
    if (/^\d+$/.test(value)) return 'INT';
    if (/^\d+\.\d+$/.test(value)) return 'FLOAT';
    if (value === 'true' || value === 'false') return 'BOOL';
    return 'STRING';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INT' : 'FLOAT';
  }
  if (typeof value === 'boolean') return 'BOOL';
  if (Array.isArray(value)) return 'ANY'; // Arrays will be handled specially
  if (value === null || value === undefined) return 'ANY';
  return 'ANY';
}

function getItemDescription(item: any): string {
  let description: any = item?.description ?? item?.request?.description ?? item?.request?.body?.description;
  if (!description) return '';
  // Postman can store description as an object with { content: string }
  if (typeof description === 'object' && typeof description.content === 'string') {
    description = description.content;
  }
  if (typeof description !== 'string') return '';
  return description.replace(/<[^>]*>/g, '').replace(/\n+/g, ' ').trim();
}

function generateSummary(item: any, method: string, path: string): string {
  const cleaned = getItemDescription(item);
  if (cleaned) {
    // Use first sentence as summary
    const firstSentence = cleaned.split(/[.!?]\s/)[0];
    return firstSentence || cleaned.substring(0, 100);
  }
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

function generateStructName(itemName: string, method: string, path: string, suffix: string): string {
  const cleanName = itemName.replace(/[^a-zA-Z0-9]/g, '');
  const cleanPath = path.replace(/[\/{}]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${method.toLowerCase()}-${cleanPath}-${suffix}`;
}

function parseJsonExample(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function extractFieldsFromObject(obj: any, depth = 0, prefix = ''): any[] {
  if (depth > 3) return [];
  if (!obj) return [];

  // If the root object is an array, extract fields from the first object
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
    return extractFieldsFromObject(obj[0], depth + 1, prefix);
  }
  if (Array.isArray(obj)) return [];
  if (typeof obj !== 'object') return [];

  const fields: any[] = [];
  const keyCount: Record<string, number> = {};

  for (const [key, value] of Object.entries(obj)) {
    let type = 'ANY';
    let required = false;

    // Handle duplicate keys
    let fieldName = key;
    if (keyCount[key] === undefined) {
      keyCount[key] = 1;
    } else {
      keyCount[key] += 1;
      fieldName = `${key} ${keyCount[key]}`;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        const firstItem = value[0];
        if (typeof firstItem === 'object' && firstItem !== null) {
          type = `[]STRUCT(${prefix}${fieldName}Item)`;
        } else {
          type = `[]${mapType(firstItem)}`;
        }
      } else {
        type = '[]ANY';
      }
    } else if (typeof value === 'object' && value !== null) {
      type = `STRUCT(${prefix}${fieldName})`;
    } else {
      type = mapType(value);
    }

    fields.push({
      name: fieldName,
      type,
      REQUIRED: required,
    });
  }

  return fields;
}

function loadEnvironmentFile(envPath: string): Record<string, string> {
  try {
    const envData = fs.readFileSync(envPath, 'utf8');
    const env = JSON.parse(envData);
    const variables: Record<string, string> = {};
    
    if (env.values) {
      for (const variable of env.values) {
        if (variable.key && variable.value) {
          variables[variable.key] = variable.value;
        }
      }
    }
    
    return variables;
  } catch (error) {
    return {};
  }
}

function extractCollectionVariables(collection: any): Record<string, string> {
  const variables: Record<string, string> = {};
  
  // Extract collection-level variables
  if (collection.variable) {
    for (const variable of collection.variable) {
      if (variable.key && variable.value) {
        variables[variable.key] = variable.value;
      }
    }
  }
  
  return variables;
}

function resolveVariables(value: string, variables: Record<string, string>): string {
  if (typeof value !== 'string') return value;
  
  // Replace {{variable}} patterns with actual values
  return value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    return variables[varName] || match;
  });
}

function extractStructs(collection: any, variables: Record<string, string>): Record<string, any[]> {
  const structs: Record<string, any[]> = {};
  const structNameCount: Record<string, number> = {};

  function getUniqueStructName(name: string): string {
    if (structs[name] === undefined) {
      structNameCount[name] = 1;
      return name;
    } else {
      structNameCount[name] = (structNameCount[name] || 1) + 1;
      return `${name} ${structNameCount[name]}`;
    }
  }
  
  function processItem(item: any) {
    if (item.request) {
      const method = item.request.method || 'GET';
      const url = item.request.url;
      const path = extractPathFromUrl(url, variables);
      const itemName = item.name || 'unknown';
      
      // Extract request body structs
      if (item.request.body?.mode === 'raw' && item.request.body.raw) {
        const bodyData = parseJsonExample(item.request.body.raw);
        if (bodyData) {
          let requestStructName = generateStructName(itemName, method, path, 'Request');
          requestStructName = getUniqueStructName(requestStructName);
          const fields = extractFieldsFromObject(bodyData, 0, requestStructName);
          if (fields.length > 0) {
            structs[requestStructName] = fields;
          }
          extractNestedStructs(bodyData, structs, requestStructName);
        }
      }
      // Extract response structs from examples
      if (item.response) {
        for (const response of item.response) {
          let responseStructName = generateStructName(itemName, method, path, `Response${response.code || '200'}`);
          responseStructName = getUniqueStructName(responseStructName);
          if (response.body) {
            const responseData = parseJsonExample(response.body);
            if (responseData) {
              const fields = extractFieldsFromObject(responseData, 0, responseStructName);
              if (fields.length > 0) {
                structs[responseStructName] = fields;
              }
              extractNestedStructs(responseData, structs, responseStructName);
            }
          }
        }
      }
    }
    if (item.item) {
      for (const subItem of item.item) {
        processItem(subItem);
      }
    }
  }
  for (const item of collection.item) {
    processItem(item);
  }
  return structs;
}

function extractNestedStructs(obj: any, structs: Record<string, any[]>, prefix = ''): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      const firstItem = value[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        const structName = `${prefix}${key}Item`;
        const fields = extractFieldsFromObject(firstItem, 0, structName);
        if (fields.length > 0) {
          structs[structName] = fields;
        }
        extractNestedStructs(firstItem, structs, `${prefix}${key}Item`);
      }
    } else if (typeof value === 'object' && value !== null) {
      const structName = `${prefix}${key}`;
      const fields = extractFieldsFromObject(value, 0, structName);
      if (fields.length > 0) {
        structs[structName] = fields;
      }
      extractNestedStructs(value, structs, `${prefix}${key}`);
    }
  }
}

function extractPathFromUrl(url: any, variables: Record<string, string>): string {
  if (url?.raw) {
    // Remove base URL and protocol
    let path = url.raw;
    path = resolveVariables(path, variables); // Resolve variables first
    path = path.replace(/^https?:\/\/[^\/]+/, ''); // Remove protocol and host
    path = path.replace(/\{\{.*?\}\}/g, ''); // Remove any remaining Postman variables
    path = path.replace(/\/+/g, '/'); // Normalize slashes
    path = path.replace(/^\/|\/$/g, ''); // Remove leading/trailing slashes
    return path;
  }
  if (url?.path) {
    const resolvedPath = url.path.map((segment: string) => resolveVariables(segment, variables));
    return resolvedPath.join('/');
  }
  return '';
}

function getContentTypeAndBodyType(request: any): { contentType: string; bodyType: string } {
  const headers = request.header || [];
  const contentTypeHeader = headers.find((h: any) => h.key?.toLowerCase() === 'content-type');
  
  let contentType = 'application/json';
  if (contentTypeHeader) {
    contentType = contentTypeHeader.value || 'application/json';
  }
  
  let bodyType = 'raw';
  if (contentType === 'multipart/form-data') {
    bodyType = 'form-data';
  } else if (contentType === 'application/x-www-form-urlencoded') {
    bodyType = 'x-www-form-urlencoded';
  }
  
  return { contentType, bodyType };
}

function getHeadersForOperation(request: any, variables: Record<string, string>): Record<string, string> {
  const { contentType } = getContentTypeAndBodyType(request);
  const headerMap = new Map<string, string>();
  
  // Add Content-Type header for POST/PUT/PATCH requests
  if (['post', 'put', 'patch'].includes(request.method?.toLowerCase() || '')) {
    headerMap.set('Content-Type', contentType);
  }
  
  // Add authentication headers
  const authHeaders = request.header || [];
  for (const header of authHeaders) {
    if (header.key && header.value) {
      const key = header.key.toLowerCase();
      if (key === 'x-api-key' || key === 'authorization' || key === 'x-signature') {
        let value = resolveVariables(header.value, variables);
        if (key === 'x-api-key') value = 'api_key';
        else if (key === 'authorization') value = 'bearer_token';
        else if (key === 'x-signature') value = 'signature';
        
        headerMap.set(header.key, value);
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

function extractParameters(request: any, variables: Record<string, string>): any[] {
  const inputParams: any[] = [];
  
  // Extract URL parameters
  const url = request.url;
  if (url?.variable) {
    for (const variable of url.variable) {
      const isRequired = !variable.disabled;
      const inputParam: any = {};
      if (isRequired) {
        // Simple form
        inputParam[variable.key] = 'STRING';
      } else {
        // Extended form
        inputParam[variable.key] = {
          TYPE: 'STRING',
          REQUIRED: false,
        };
      }
      inputParams.push(inputParam);
    }
  }
  
  // Extract query parameters
  if (url?.query) {
    for (const query of url.query) {
      const isRequired = !query.disabled;
      const inputParam: any = {};
      if (isRequired) {
        // Simple form
        inputParam[query.key] = 'STRING';
      } else {
        // Extended form
        inputParam[query.key] = {
          TYPE: 'STRING',
          REQUIRED: false,
        };
      }
      inputParams.push(inputParam);
    }
  }
  
  return inputParams;
}

function extractRequestBody(request: any, itemName: string, method: string, path: string): any[] {
  const inputParams: any[] = [];
  
  if (request.body?.mode === 'raw' && request.body.raw) {
    const bodyData = parseJsonExample(request.body.raw);
    if (bodyData) {
      const requestStructName = generateStructName(itemName, method, path, 'Request');
      const inputParam: any = {};
      inputParam.body = {
        TYPE: `STRUCT(${requestStructName})`,
        REQUIRED: true,
      };
      inputParams.push(inputParam);
    }
  }
  
  // Handle form-data and urlencoded
  if (request.body?.mode === 'formdata' || request.body?.mode === 'urlencoded') {
    const formData = request.body.formdata || request.body.urlencoded || [];
    for (const field of formData) {
      const type = field.type === 'file' ? 'STRING' : 'STRING';
      const isRequired = !field.disabled;
      const inputParam: any = {};
      if (isRequired) {
        inputParam[field.key] = type;
      } else {
        inputParam[field.key] = {
          TYPE: type,
          REQUIRED: false,
        };
      }
      inputParams.push(inputParam);
    }
  }
  
  return inputParams;
}

function extractResponses(item: any, itemName: string, method: string, path: string): any[] {
  const returns: any[] = [];
  const seenCodes = new Set<string>();
  
  if (item.response) {
    for (const response of item.response) {
      const code = response.code?.toString() || '200';
      const statusCode = parseInt(code);
      
      // Only include success responses (2xx) in RETURNS section
      // Error responses go in ERRORS section
      if (isNaN(statusCode) || statusCode < 200 || statusCode >= 300) {
        continue;
      }
      
      // Avoid duplicate response codes
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      
      // Skip 204 No Content
      if (code === '204') continue;
      
      let returnType = 'ANY';
      
      if (response.body) {
        const responseData = parseJsonExample(response.body);
        if (responseData) {
          const responseStructName = generateStructName(itemName, method, path, `Response${code}`);
          returnType = `STRUCT(${responseStructName})`;
        }
      }
      
      // Only add if there's actually a return type
      if (returnType !== TYPE_VOID) {
        // Generate descriptive RETURNVAR name based on response code and operation
        // Clean itemName: replace spaces and special chars with underscores, convert to lowercase
        const cleanItemName = itemName
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '')
          .toLowerCase();
        const returnVarName = generateReturnVarName(cleanItemName, code);
        
        returns.push({
          RETURNTYPE: returnType,
          RETURNVAR: returnVarName,
        });
      }
    }
  }
  
  return returns;
}

function extractErrors(item: any, itemName: string, method: string, path: string): any[] {
  const errors: any[] = [];
  
  if (item.response) {
    for (const response of item.response) {
      const code = parseInt(response.code?.toString() || '200');
      if (isNaN(code) || code < 400) continue;
      
      let errorType = 'ANY';
      let when = `HTTP ${code}`;
      
      if (response.body) {
        const responseData = parseJsonExample(response.body);
        if (responseData) {
          const errorStructName = `Error${code}`;
          errorType = `STRUCT(${errorStructName})`;
        }
      }
      
      when = generateErrorWhen(response, code.toString());
      
      errors.push({
        TYPE: errorType,
        WHEN: when,
      });
    }
  }
  
  return errors;
}

function extractOperations(collection: any, variables: Record<string, string>): any[] {
  const operations: any[] = [];
  const operationNameCount: Record<string, number> = {};

  function getUniqueOperationName(name: string): string {
    if (operationNameCount[name] === undefined) {
      operationNameCount[name] = 1;
      return name;
    } else {
      operationNameCount[name] += 1;
      return `${name} ${operationNameCount[name]}`;
    }
  }
  
  function processItem(item: any, parentName: string | null = null) {
    if (item.request) {
      const method = item.request.method || 'GET';
      const url = item.request.url;
      const path = extractPathFromUrl(url, variables);
      const itemName = item.name || 'unknown';
      const immediateParentName = parentName || null;
      // Generate operation ID (alias)
      let operationId = itemName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      operationId = getUniqueOperationName(operationId);
      
      const summary = generateSummary(item, method, path);
      const { bodyType } = getContentTypeAndBodyType(item.request);
      const headers = getHeadersForOperation(item.request, variables);
      const inputs = extractParameters(item.request, variables);
      const bodyInputs = extractRequestBody(item.request, itemName, method, path);
      const returns = extractResponses(item, itemName, method, path);
      const errors = extractErrors(item, itemName, method, path);
      const allInputs = [...inputs];
      if (bodyInputs.length > 0) {
        allInputs.push(...bodyInputs);
      }
      
      // Build method in v2.0.1 format
      const methodDef: any = {
        SUMMARY: summary,
      };

      // Add DESC if description exists
      const desc = getItemDescription(item);
      if (desc) {
        methodDef.DESC = desc;
      }

      // HTTP section (mandatory for API methods)
      methodDef.HTTP = {
        METHOD: method.toUpperCase(),
        ENDPOINT: `/${path}`,
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
      if (allInputs.length > 0) {
        methodDef.INPUTS = allInputs;
      }

      // RETURNS section (optional - omit for void)
      if (returns.length > 0) {
        methodDef.RETURNS = returns;
      }

      // ERRORS section (optional)
      if (errors.length > 0) {
        methodDef.ERRORS = errors;
      }
      
      operations.push({
        name: operationId,
        ...methodDef,
      });
    }
    if (item.item) {
      for (const subItem of item.item) {
        processItem(subItem, item.name || parentName || null);
      }
    }
  }
  for (const item of collection.item) {
    processItem(item, null);
  }
  return operations;
}


function extractBaseUrl(collection: any, variables: Record<string, string>): string {
  // First, try to get from collection variables (merged with passed variables)
  const collectionVars = extractCollectionVariables(collection);
  const allVariables = { ...collectionVars, ...variables };
  
      // Check for common base URL variable names
      for (const varName of BASE_URL_VARIABLE_NAMES) {
    if (allVariables[varName]) {
      let baseUrl = allVariables[varName];
      // Remove trailing slash
      baseUrl = baseUrl.replace(/\/$/, '');
      // If it's a variable placeholder, skip it
      if (!baseUrl.startsWith('{{')) {
        return baseUrl;
      }
    }
  }
  
  // Try to extract from first request URL
  function findFirstRequestUrl(item: any): string | null {
    if (item.request?.url) {
      const url = item.request.url;
      if (url.raw) {
        // Extract base URL from raw URL
        // Handle cases like "{{url}}/api/v1/endpoint" or "https://api.example.com/api/v1/endpoint"
        let rawUrl = url.raw;
        
        // Try to resolve variables first
        rawUrl = resolveVariables(rawUrl, allVariables);
        
        // Extract base URL (protocol + host)
        const match = rawUrl.match(/^(https?:\/\/[^\/\s]+)/);
        if (match) {
          return match[1];
        }
        
        // If still has variables, try to extract from host array
        if (url.host && Array.isArray(url.host) && url.host.length > 0) {
          const host = url.host[0];
          const resolvedHost = resolveVariables(host, allVariables);
          // If host is resolved and not a variable placeholder
          if (resolvedHost && !resolvedHost.startsWith('{{') && !resolvedHost.includes('{{')) {
            const protocol = (url.protocol && !url.protocol.startsWith('{{')) 
              ? url.protocol.replace(':', '') 
              : 'https';
            return `${protocol}://${resolvedHost}`;
          }
        }
      }
    }
    if (item.item && Array.isArray(item.item)) {
      for (const subItem of item.item) {
        const found = findFirstRequestUrl(subItem);
        if (found) return found;
      }
    }
    return null;
  }
  
  if (collection.item && Array.isArray(collection.item)) {
    for (const item of collection.item) {
      const baseUrl = findFirstRequestUrl(item);
      if (baseUrl) {
        return baseUrl.replace(/\/$/, '');
      }
    }
  }
  
  // Default fallback
  return DEFAULT_BASE_URL;
}

function generateWrekenfile(collection: any, variables: Record<string, string>): string {
  if (!collection || typeof collection !== 'object') {
    throw new Error("Argument 'collection' is required and must be an object");
  }
  if (!variables || typeof variables !== 'object') {
    throw new Error("Argument 'variables' is required and must be an object");
  }
  
  // Extract base URL from collection
  const baseUrl = extractBaseUrl(collection, variables);
  
  // Merge collection variables with passed variables
  const collectionVars = extractCollectionVariables(collection);
  const allVariables = { ...collectionVars, ...variables };
  
  const structs = extractStructs(collection, allVariables);
  const operations = extractOperations(collection, allVariables);
  
  const wrekenfile: any = {
    VERSION: WREKENFILE_VERSION,
  };

  // Add DEFAULTS if we have any
  const defaults: Record<string, string> = {};
  
  // Add base URL first
  defaults.w_base_url = baseUrl;
  
  // Add other variables
  if (Object.keys(allVariables).length > 0) {
    for (const [key, value] of Object.entries(allVariables)) {
      // Skip base URL variables as we've already added w_base_url
      if (BASE_URL_VARIABLE_NAMES.includes(key)) {
        continue;
      }
      const isSensitive = SENSITIVE_KEYS.some(sensitiveKey => key.toLowerCase().includes(sensitiveKey));
      if (isSensitive) {
        defaults[key] = `{{${key}}}`;
      } else {
        defaults[key] = value;
      }
    }
  }
  
  if (Object.keys(defaults).length > 0) {
    wrekenfile.DEFAULTS = defaults;
  }

  // Add METHODS (mandatory)
  const methods: Record<string, any> = {};
  for (const operation of operations) {
    const { name, ...methodDef } = operation;
    methods[name] = methodDef;
  }
  wrekenfile.METHODS = methods;

  // Add STRUCTS if we have any
  if (Object.keys(structs).length > 0) {
    wrekenfile.STRUCTS = structs;
  }

  let yamlString = dump(wrekenfile, YAML_DUMP_OPTIONS);

  // Post-process to remove quotes from type strings
  yamlString = removeTypeQuotes(yamlString);

  yamlString = cleanYaml(yamlString);
  checkYamlForHiddenChars(yamlString);
  validateYaml(yamlString);
  return yamlString;
}

export {
  generateWrekenfile,
  extractStructs,
  extractOperations,
  mapType,
  parseJsonExample,
  extractFieldsFromObject,
  loadEnvironmentFile,
  extractCollectionVariables,
  resolveVariables,
};

