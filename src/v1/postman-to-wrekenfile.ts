import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';

type Primitive = 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'DATE' | 'ANY' | 'UUID';

function mapType(value: any): Primitive {
  if (typeof value === 'string') {
    // Check for common patterns
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'DATE';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'UUID';
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

function generateDesc(item: any, method: string, path: string): string {
  const cleaned = getItemDescription(item);
  if (cleaned) return cleaned;
  return `${method.toUpperCase()} ${path}`;
}

function generateStructName(_itemName: string, method: string, path: string, suffix: string): string {
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
    let required = 'OPTIONAL';

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
      required,
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
    console.warn(`Warning: Could not load environment file ${envPath}:`, error);
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
          structs[requestStructName] = fields.length > 0 ? fields : [];
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
              structs[responseStructName] = fields.length > 0 ? fields : [];
              extractNestedStructs(responseData, structs, responseStructName);
            } else {
              structs[responseStructName] = [];
            }
          } else {
            structs[responseStructName] = [];
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
        // Always add the struct, even if empty
        structs[structName] = fields.length > 0 ? fields : [];
        extractNestedStructs(firstItem, structs, `${prefix}${key}Item`);
      }
    } else if (typeof value === 'object' && value !== null) {
      const structName = `${prefix}${key}`;
      const fields = extractFieldsFromObject(value, 0, structName);
      // Always add the struct, even if empty
      structs[structName] = fields.length > 0 ? fields : [];
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

function getHeadersForOperation(request: any, variables: Record<string, string>): Record<string, string>[] {
  const { contentType } = getContentTypeAndBodyType(request);
  const headers: Record<string, string>[] = [];
  
  // Add Content-Type header
  headers.push({ 'Content-Type': contentType });
  
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
        
        headers.push({ [header.key]: value });
      }
    }
  }
  
  return headers;
}

function extractParameters(request: any, _variables: Record<string, string>): any[] {
  const inputParams: any[] = [];
  
  // Extract URL parameters
  const url = request.url;
  if (url?.variable) {
    for (const variable of url.variable) {
      inputParams.push({
        name: variable.key,
        type: 'STRING',
        required: variable.disabled ? 'FALSE' : 'TRUE',
        location: 'PATH',
      });
    }
  }
  
  // Extract query parameters
  if (url?.query) {
    for (const query of url.query) {
      inputParams.push({
        name: query.key,
        type: 'STRING',
        required: query.disabled ? 'FALSE' : 'TRUE',
        location: 'QUERY',
      });
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
      inputParams.push({
        name: 'body',
        type: `STRUCT(${requestStructName})`,
        required: 'TRUE',
      });
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
      
      // Avoid duplicate response codes
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      
      let returnType = 'ANY';
      
      if (response.body) {
        const responseData = parseJsonExample(response.body);
        if (responseData) {
          const responseStructName = generateStructName(itemName, method, path, `Response${code}`);
          returnType = `STRUCT(${responseStructName})`;
        }
      }
      
      returns.push({
        RETURNTYPE: returnType,
        RETURNNAME: 'response',
        CODE: code,
      });
    }
  } else {
    // Default response if no examples provided
    returns.push({
      RETURNTYPE: 'ANY',
      RETURNNAME: 'response',
      CODE: '200',
    });
  }
  
  return returns;
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
      // Generate operation ID
      let operationId = itemName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      operationId = getUniqueOperationName(operationId);
      const { contentType: _contentType, bodyType } = getContentTypeAndBodyType(item.request);
      const headers = getHeadersForOperation(item.request, variables);
      const inputs = extractParameters(item.request, variables);
      const bodyInputs = extractRequestBody(item.request, itemName, method, path);
      const returns = extractResponses(item, itemName, method, path);
      const allInputs = [...inputs];
      if (bodyInputs.length > 0) {
        allInputs.push(...bodyInputs);
      }
      operations.push({
        name: operationId,
        SUMMARY: itemName || '',
        DESC: generateDesc(item, method, path),
        TAGS: immediateParentName ? [immediateParentName] : (itemName ? [itemName] : []),
        ENDPOINT: `"/${path}"`,
        VISIBILITY: 'PUBLIC',
        HTTP: {
          METHOD: method.toUpperCase(),
          HEADERS: headers,
          BODYTYPE: bodyType,
        },
        INPUTS: allInputs,
        RETURNS: returns,
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

function cleanYaml(yamlString: string): string {
  // Remove tabs, non-breaking spaces, and non-printable chars except standard whitespace and newlines
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

function generateWrekenfile(collection: any, variables: Record<string, string>): string {
  if (!collection || typeof collection !== 'object') {
    throw new Error("Argument 'collection' is required and must be an object");
  }
  if (!variables || typeof variables !== 'object') {
    throw new Error("Argument 'variables' is required and must be an object");
  }
  const structs = extractStructs(collection, variables);
  const operations = extractOperations(collection, variables);
  
  let wrekenfile = `VERSION: '1.2'\n`;
  wrekenfile += `INIT:\n`;
  wrekenfile += `  DEFAULTS:\n`;
  if (Object.keys(variables).length === 0) {
    wrekenfile += `    - w_base_url: https://api.default.com\n`;
  } else {
    for (const [key, value] of Object.entries(variables)) {
      const sensitiveKeys = ['api_key', 'api-key', 'x-api-key', 'signature', 'x-signature', 'authorization', 'token', 'password', 'secret'];
      const isSensitive = sensitiveKeys.some(sensitiveKey => key.toLowerCase().includes(sensitiveKey));
      if (isSensitive) {
        wrekenfile += `    - ${key}: "{{${key}}}"\n`;
      } else {
        wrekenfile += `    - ${key}: "${value}"\n`;
      }
    }
  }
  
  wrekenfile += `INTERFACES:\n`;
  for (const operation of operations) {
    wrekenfile += `  ${operation.name}:\n`;
    // Always quote SUMMARY and DESC to avoid YAML parse issues
    const summary = `"${String(operation.SUMMARY || '').replace(/"/g, '\\"')}"`;
    const desc = `"${String(operation.DESC || '').replace(/"/g, '\\"')}"`;
    wrekenfile += `    SUMMARY: ${summary}\n`;
    wrekenfile += `    DESC: ${desc}\n`;
    // TAGS
     if (!operation.TAGS || operation.TAGS.length === 0) {
       wrekenfile += `    TAGS: []\n`;
     } else {
       wrekenfile += `    TAGS:\n`;
       for (const tag of operation.TAGS) {
         const tagVal = `"${String(tag).replace(/"/g, '\\"')}"`;
         wrekenfile += `      - ${tagVal}\n`;
       }
     }
    wrekenfile += `    ENDPOINT: ${operation.ENDPOINT}\n`;
    wrekenfile += `    VISIBILITY: ${operation.VISIBILITY}\n`;
    wrekenfile += `    HTTP:\n`;
    wrekenfile += `      METHOD: ${operation.HTTP.METHOD}\n`;
    wrekenfile += `      HEADERS:\n`;
    for (const header of operation.HTTP.HEADERS) {
      for (const [key, value] of Object.entries(header)) {
        wrekenfile += `        - ${key}: ${value}\n`;
      }
    }
    wrekenfile += `      BODYTYPE: ${operation.HTTP.BODYTYPE}\n`;
    
     // INPUTS
     if (operation.INPUTS.length === 0) {
       wrekenfile += `    INPUTS: []\n`;
     } else {
       wrekenfile += `    INPUTS:\n`;
       for (const input of operation.INPUTS) {
         wrekenfile += `      - name: ${input.name}\n`;
         wrekenfile += `        type: "${String(input.type).replace(/"/g, '\\"')}"\n`;
         wrekenfile += `        required: '${input.required}'\n`;
         if (input.location) {
           wrekenfile += `        location: ${input.location}\n`;
         }
       }
     }
    
     // RETURNS
     wrekenfile += `    RETURNS:\n`;
     for (const ret of operation.RETURNS) {
       wrekenfile += `      - RETURNTYPE: "${String(ret.RETURNTYPE).replace(/"/g, '\\"')}"\n`;
       wrekenfile += `        RETURNNAME: ${ret.RETURNNAME}\n`;
       wrekenfile += `        CODE: '${ret.CODE}'\n`;
     }
  }
  
  wrekenfile += `STRUCTS:\n`;
    for (const [structName, fields] of Object.entries(structs)) {
      if (fields.length === 0) {
        wrekenfile += `  ${structName}: []\n`;
      } else {
        wrekenfile += `  ${structName}:\n`;
        for (const field of fields) {
          wrekenfile += '    - name: ' + field.name + '\n';
          const typeValue = '"' + String(field.type).replace(/"/g, '\\"') + '"';
          wrekenfile += '      type: ' + typeValue + '\n';
          wrekenfile += "      required: '" + field.required + "'\n";
        }
      }
    }
  
  // Debug print: show first 20 lines of STRUCTS block
  wrekenfile = cleanYaml(wrekenfile);
  checkYamlForHiddenChars(wrekenfile);
  validateYaml(wrekenfile);
  return wrekenfile;
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