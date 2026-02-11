import * as yaml from 'js-yaml';
import * as fs from 'fs';
import {
  MINI_FILENAME_PREFIX,
  YAML_EXTENSION,
  DEFAULT_MINI_OUTPUT_DIR,
  FILENAME_INVALID_CHARS,
  FILENAME_MULTIPLE_HYPHENS,
  FILENAME_LEADING_TRAILING_HYPHENS,
  FILENAME_LEADING_SLASHES,
  FILENAME_TRAILING_SLASHES,
} from './utils/constants';
import { generateYamlString } from './utils/yaml-utils';

export interface MiniWrekenfile {
  content: string;
  metadata: {
    endpoint?: string;
    interface?: string;
    source?: string;
    methods: string[];
    structs: string[];
    filename: string;
    canonicalId?: string;
  };
}

interface WrekenfileData {
  VERSION: string;
  DEFAULTS?: Record<string, any>;
  SOURCES?: Record<string, any>;
  METHODS: Record<string, any>;
  STRUCTS?: Record<string, any>;
}

export function generateMiniWrekenfiles(wrekenfileContent: string): MiniWrekenfile[] {
  if (!wrekenfileContent || typeof wrekenfileContent !== 'string') {
    throw new Error("Argument 'wrekenfileContent' is required and must be a string");
  }
  
  const data = yaml.load(wrekenfileContent) as WrekenfileData;
  
  if (!data.METHODS) {
    throw new Error('No METHODS section found in Wrekenfile');
  }

  // v2.0.2-mini: One mini-wrekenfile per method (not grouped)
  // CANONICAL_ID is already set in the main Wrekenfile METHODS
  const miniWrekenfiles: MiniWrekenfile[] = [];
  for (const [methodId, methodData] of Object.entries(data.METHODS)) {
    const canonicalId = methodData.CANONICAL_ID;
    miniWrekenfiles.push(createMiniWrekenfile(data, methodId, methodData, canonicalId));
  }
  return miniWrekenfiles;
}

// v2.0.2-mini: No grouping needed - one mini-wrekenfile per method

function createMiniWrekenfile(
  data: WrekenfileData,
  methodId: string,
  methodData: any,
  canonicalId?: string
): MiniWrekenfile {
  // Unified Mini-Wrekenfile v2.0.2: Execution-complete structure
  const miniData: any = {
    VERSION: '2.0.2',
    METHOD: {
      ID: methodId,
      SUMMARY: methodData.SUMMARY || '',
    },
  };

  if (canonicalId) {
    miniData.METHOD.CANONICAL_ID = canonicalId;
  }
  if (methodData.DESC) {
    miniData.METHOD.DESC = methodData.DESC;
  }

  // EXECUTION section
  const execution = methodData.EXECUTION || {};
  miniData.EXECUTION = {
    KIND: execution.KIND || (methodData.HTTP ? 'http' : (methodData.SDK ? 'sdk' : 'http')),
    MODE: execution.MODE || 'async',
    EXECUTION_LEVEL: 'standalone',
  };

  // HTTP section (optional but include if present)
  if (methodData.HTTP) {
    miniData.HTTP = {
      METHOD: methodData.HTTP.METHOD,
      ENDPOINT: methodData.HTTP.ENDPOINT,
    };
    
    if (methodData.HTTP.CONTENT_TYPE) {
      miniData.HTTP.CONTENT_TYPE = methodData.HTTP.CONTENT_TYPE;
    }
    if (methodData.HTTP.ACCEPT) {
      miniData.HTTP.ACCEPT = methodData.HTTP.ACCEPT;
    }
    if (methodData.HTTP.HEADERS) {
      miniData.HTTP.HEADERS = methodData.HTTP.HEADERS;
    }
  }

  // SDK section (optional but include if present)
  if (methodData.SDK) {
    miniData.SDK = {
      INTERFACE: methodData.SDK.INTERFACE ? {
        NAME: methodData.SDK.INTERFACE.NAME,
      } : undefined,
      INVOCATION: methodData.SDK.INVOCATION ? {
        TYPE: methodData.SDK.INVOCATION.TYPE,
        RECEIVER: methodData.SDK.INVOCATION.RECEIVER,
      } : undefined,
    };
    // Remove undefined fields
    if (!miniData.SDK.INTERFACE) delete miniData.SDK.INTERFACE;
    if (!miniData.SDK.INVOCATION) delete miniData.SDK.INVOCATION;
    if (Object.keys(miniData.SDK).length === 0) delete miniData.SDK;
  } else if (methodData.INTERFACE || methodData.INVOCATION) {
    // Handle legacy format
    miniData.SDK = {};
    if (methodData.INTERFACE?.NAME) {
      miniData.SDK.INTERFACE = {
        NAME: methodData.INTERFACE.NAME,
      };
    }
    if (methodData.INVOCATION) {
      miniData.SDK.INVOCATION = {
        TYPE: methodData.INVOCATION.TYPE,
        RECEIVER: methodData.INVOCATION.RECEIVER,
      };
    }
  }

  // INPUTS section - keep LOCATION and all details
  if (methodData.INPUTS && methodData.INPUTS.length > 0) {
    miniData.INPUTS = methodData.INPUTS.map((input: any) => {
      const inputKey = Object.keys(input)[0];
      const inputValue = input[inputKey];
      
      if (typeof inputValue === 'string') {
        // Simple form: - name: TYPE
        // Need to determine LOCATION from context
        const location = determineInputLocation(inputKey, methodData);
        return {
          name: inputKey,
          TYPE: inputValue,
          REQUIRED: true,
          LOCATION: location,
        };
      } else if (typeof inputValue === 'object') {
        // Extended form: - name: { TYPE: ..., REQUIRED: ..., LOCATION: ... }
        const cleanedInput: any = {
          name: inputKey,
          TYPE: inputValue.TYPE,
          REQUIRED: inputValue.REQUIRED !== undefined ? inputValue.REQUIRED : true,
        };
        // Keep LOCATION if present, otherwise determine from context
        if (inputValue.LOCATION) {
          cleanedInput.LOCATION = inputValue.LOCATION;
        } else {
          cleanedInput.LOCATION = determineInputLocation(inputKey, methodData);
        }
        // Keep DESC if present
        if (inputValue.DESC) {
          cleanedInput.DESC = inputValue.DESC;
        }
        return cleanedInput;
      }
      return null;
    }).filter(Boolean);
  }

  // RETURNS section - single object with TYPE and DESC
  if (methodData.RETURNS && methodData.RETURNS.length > 0) {
    // Use the first return type
    const firstReturn = methodData.RETURNS[0];
    miniData.RETURNS = {
      TYPE: firstReturn.RETURNTYPE || 'ANY',
    };
    if (firstReturn.DESC) {
      miniData.RETURNS.DESC = firstReturn.DESC;
    }
  } else if (methodData.ASYNC?.RESULT?.TYPE) {
    miniData.RETURNS = {
      TYPE: methodData.ASYNC.RESULT.TYPE,
    };
  }

  // ERRORS section (optional)
  if (methodData.ERRORS && methodData.ERRORS.length > 0) {
    miniData.ERRORS = methodData.ERRORS.map((error: any) => ({
      TYPE: error.TYPE || 'ANY',
      WHEN: error.WHEN || '',
    }));
  }

  // STRUCTS section - collect and include required structs
  const requiredStructs = collectRequiredStructs(methodData, data.STRUCTS || {});
  if (Object.keys(requiredStructs).length > 0) {
    miniData.STRUCTS = requiredStructs;
  }

  // Generate YAML string
  const content = generateYamlString(miniData);

  // Metadata
  const metadata: MiniWrekenfile['metadata'] = {
    methods: [methodId],
    structs: Object.keys(requiredStructs),
    filename: generateFilename(methodId, methodData),
  };
  if (canonicalId) {
    metadata.canonicalId = canonicalId;
  }
  if (methodData.HTTP?.ENDPOINT) {
    metadata.endpoint = methodData.HTTP.ENDPOINT;
  }
  if (miniData.SDK?.INTERFACE?.NAME) {
    metadata.interface = miniData.SDK.INTERFACE.NAME;
  }
  if (methodData.SOURCE) {
    metadata.source = methodData.SOURCE;
  }

  return { content, metadata };
}

// Helper function to determine input location from context
function determineInputLocation(inputKey: string, methodData: any): string {
  // Check if it's a path parameter
  if (methodData.HTTP?.ENDPOINT) {
    const endpoint = methodData.HTTP.ENDPOINT;
    if (endpoint.includes(`{${inputKey}}`) || endpoint.includes(`{{${inputKey}}}`)) {
      return 'path';
    }
  }
  
  // Check if it's a header
  if (methodData.HTTP?.HEADERS && methodData.HTTP.HEADERS[inputKey]) {
    return 'header';
  }
  
  // Check if it's body
  if (inputKey === 'body' || methodData.HTTP?.BODY?.TYPE) {
    return 'body';
  }
  
  // Default to query for HTTP, sdk for SDK
  if (methodData.HTTP) {
    return 'query';
  }
  return 'sdk';
}

// Collect required structs for this method
function collectRequiredStructs(methodData: any, allStructs: Record<string, any>): Record<string, any> {
  const requiredStructs: Record<string, any> = {};
  const processedStructs = new Set<string>();
  const structRefs = new Set<string>();
  
  // Extract struct references from INPUTS
  if (methodData.INPUTS) {
    for (const input of methodData.INPUTS) {
      for (const value of Object.values(input)) {
        const type = extractTypeFromInput(value);
        if (type) collectStructRefsFromType(type, structRefs);
      }
    }
  }
  
  // Extract struct references from RETURNS
  if (methodData.RETURNS) {
    for (const ret of methodData.RETURNS) {
      if (ret.RETURNTYPE) collectStructRefsFromType(ret.RETURNTYPE, structRefs);
    }
  }
  
  // Extract struct references from ERRORS
  if (methodData.ERRORS) {
    for (const error of methodData.ERRORS) {
      if (error.TYPE) collectStructRefsFromType(error.TYPE, structRefs);
    }
  }
  
  // Extract from HTTP.BODY.TYPE
  if (methodData.HTTP?.BODY?.TYPE) {
    collectStructRefsFromType(methodData.HTTP.BODY.TYPE, structRefs);
  }
  
  // Extract from ASYNC.RESULT.TYPE
  if (methodData.ASYNC?.RESULT?.TYPE) {
    collectStructRefsFromType(methodData.ASYNC.RESULT.TYPE, structRefs);
  }
  
  // Recursively collect structs
  for (const structName of structRefs) {
    collectStructRecursively(structName, allStructs, requiredStructs, processedStructs);
  }
  
  return requiredStructs;
}

function extractTypeFromInput(value: any): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'TYPE' in value) return (value as any).TYPE;
  return null;
}

function collectStructRefsFromType(type: string, structRefs: Set<string>): void {
  const structNames = extractAllStructNames(type);
  for (const structName of structNames) {
    if (structName) structRefs.add(structName);
  }
}

function collectStructRecursively(
  structName: string,
  allStructs: Record<string, any>,
  requiredStructs: Record<string, any>,
  processedStructs: Set<string>
): void {
  if (processedStructs.has(structName) || !allStructs[structName]) {
    return;
  }
  
  processedStructs.add(structName);
  requiredStructs[structName] = allStructs[structName];
  
  // Check for nested structs in fields
  const structData = allStructs[structName];
  if (Array.isArray(structData)) {
    // Old format: array of fields
    for (const field of structData) {
      if (field.type) {
        const nestedStructNames = extractAllStructNames(field.type);
        for (const nestedStructName of nestedStructNames) {
          if (nestedStructName) {
            collectStructRecursively(nestedStructName, allStructs, requiredStructs, processedStructs);
          }
        }
      }
    }
  } else if (structData && typeof structData === 'object' && structData.FIELDS) {
    // New format: { DESC: ..., FIELDS: [...] }
    for (const field of structData.FIELDS) {
      if (field.TYPE) {
        const nestedStructNames = extractAllStructNames(field.TYPE);
        for (const nestedStructName of nestedStructNames) {
          if (nestedStructName) {
            collectStructRecursively(nestedStructName, allStructs, requiredStructs, processedStructs);
          }
        }
      }
    }
  }
}

const STRUCT_REGEX = /^STRUCT\(([^)]+)\)/;
const ARRAY_STRUCT_REGEX = /^\[\]STRUCT\(([^)]+)\)/;
const MAP_STRUCT_REGEX = /map\[[^\]]+\]STRUCT\(([^)]+)\)/;

function extractAllStructNames(typeString: string): string[] {
  const matches: string[] = [];
  const match1 = typeString.match(STRUCT_REGEX);
  const match2 = typeString.match(ARRAY_STRUCT_REGEX);
  const match3 = typeString.match(MAP_STRUCT_REGEX);
  if (match1) matches.push(match1[1]);
  if (match2) matches.push(match2[1]);
  if (match3) matches.push(match3[1]);
  return matches;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(FILENAME_LEADING_SLASHES, '')
    .replace(FILENAME_TRAILING_SLASHES, '')
    .replace(FILENAME_INVALID_CHARS, '-')
    .replace(FILENAME_MULTIPLE_HYPHENS, '-')
    .replace(FILENAME_LEADING_TRAILING_HYPHENS, '');
}

function generateFilename(
  methodId: string,
  methodData: any
): string {
  // v2.0.2-mini: One file per method, use method ID as filename
  const cleanName = sanitizeFilename(methodId);
  return `${MINI_FILENAME_PREFIX}${cleanName}${YAML_EXTENSION}`;
}

export function saveMiniWrekenfiles(miniWrekenfiles: MiniWrekenfile[], outputDir: string = DEFAULT_MINI_OUTPUT_DIR): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  for (const miniFile of miniWrekenfiles) {
    const filePath = `${outputDir}/${miniFile.metadata.filename}`;
    fs.writeFileSync(filePath, miniFile.content);
  }
}

