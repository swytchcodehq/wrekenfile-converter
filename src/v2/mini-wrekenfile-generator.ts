import * as yaml from 'js-yaml';
import * as fs from 'fs';
import {
  GROUP_PREFIX_HTTP,
  GROUP_PREFIX_SDK,
  GROUP_PREFIX_OTHER,
  MINI_FILENAME_PREFIX,
  YAML_EXTENSION,
  DEFAULT_MINI_OUTPUT_DIR,
  FILENAME_INVALID_CHARS,
  FILENAME_MULTIPLE_HYPHENS,
  FILENAME_LEADING_TRAILING_HYPHENS,
  FILENAME_LEADING_SLASHES,
  FILENAME_TRAILING_SLASHES,
} from './utils/constants';

export interface MiniWrekenfile {
  content: string;
  metadata: {
    endpoint?: string;
    interface?: string;
    source?: string;
    methods: string[];
    structs: string[];
    filename: string;
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

  const methodGroups = groupMethods(data.METHODS);
  const miniWrekenfiles: MiniWrekenfile[] = [];
  
  for (const [groupKey, groupInfo] of Object.entries(methodGroups)) {
    miniWrekenfiles.push(createMiniWrekenfile(data, groupKey, groupInfo));
  }
  
  return miniWrekenfiles;
}

interface MethodGroupInfo {
  methods: Record<string, any>;
  type: 'http' | 'sdk' | 'other';
  endpoint?: string;
  interface?: string;
  source?: string;
}

const BACKTICK = '`';
const SLASH = '/';

function normalizeEndpoint(endpoint: string): string {
  endpoint = endpoint.trim();
  if (endpoint.startsWith(BACKTICK) && endpoint.endsWith(BACKTICK)) {
    endpoint = endpoint.slice(1, -1).trim();
  }
  if (endpoint.startsWith(SLASH)) {
    endpoint = endpoint.substring(1);
  }
  return endpoint;
}

function groupMethods(methods: Record<string, any>): Record<string, MethodGroupInfo> {
  const groups: Record<string, MethodGroupInfo> = {};
  
  for (const [methodName, methodData] of Object.entries(methods)) {
    if (methodData.HTTP?.ENDPOINT) {
      const endpoint = normalizeEndpoint(methodData.HTTP.ENDPOINT);
      const groupKey = `${GROUP_PREFIX_HTTP}${endpoint}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          methods: {},
          type: 'http',
          endpoint: endpoint
        };
      }
      groups[groupKey].methods[methodName] = methodData;
    } else if (methodData.INTERFACE?.NAME) {
      const interfaceName = methodData.INTERFACE.NAME;
      const source = methodData.SOURCE;
      const groupKey = source ? `${GROUP_PREFIX_SDK}${source}:${interfaceName}` : `${GROUP_PREFIX_SDK}${interfaceName}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          methods: {},
          type: 'sdk',
          interface: interfaceName,
          source: source
        };
      }
      groups[groupKey].methods[methodName] = methodData;
    } else if (methodData.SOURCE) {
      // SDK methods with SOURCE but no INTERFACE.NAME - group by SOURCE
      const source = methodData.SOURCE;
      const groupKey = `${GROUP_PREFIX_SDK}${source}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          methods: {},
          type: 'sdk',
          source: source
        };
      }
      groups[groupKey].methods[methodName] = methodData;
    } else {
      const groupKey = `${GROUP_PREFIX_OTHER}${methodName}`;
      groups[groupKey] = {
        methods: { [methodName]: methodData },
        type: 'other'
      };
    }
  }
  
  return groups;
}

function createMiniWrekenfile(
  data: WrekenfileData, 
  groupKey: string, 
  groupInfo: MethodGroupInfo
): MiniWrekenfile {
  const { methods, type, endpoint, interface: interfaceName, source } = groupInfo;
  const requiredStructs = collectRequiredStructs(methods, data.STRUCTS || {});
  
  const miniData: any = {
    VERSION: data.VERSION,
    METHODS: methods,
  };
  
  if (type === 'sdk' && source && data.SOURCES?.[source]) {
    miniData.SOURCES = { [source]: data.SOURCES[source] };
  }
  
  if (data.DEFAULTS && Object.keys(data.DEFAULTS).length > 0) {
    miniData.DEFAULTS = data.DEFAULTS;
  }
  
  if (Object.keys(requiredStructs).length > 0) {
    miniData.STRUCTS = requiredStructs;
  }
  
  const content = yaml.dump(miniData, { 
    indent: 2, 
    lineWidth: -1,
    noRefs: true 
  });
  
  const methodList = Object.values(methods).map((method: any) => {
    return method.HTTP?.METHOD || method.INTERFACE?.NAME || Object.keys(methods)[0];
  }).filter(Boolean);
  
  const metadata: MiniWrekenfile['metadata'] = {
    methods: methodList,
    structs: Object.keys(requiredStructs),
    filename: generateFilename(groupKey, type, endpoint, interfaceName, source)
  };
  
  if (endpoint) metadata.endpoint = `/${endpoint}`;
  if (interfaceName) metadata.interface = interfaceName;
  if (source) metadata.source = source;
  
  return { content, metadata };
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

function collectRequiredStructs(
  methods: Record<string, any>, 
  allStructs: Record<string, any>
): Record<string, any> {
  const requiredStructs: Record<string, any> = {};
  const processedStructs = new Set<string>();
  const structRefs = new Set<string>();
  
  for (const methodData of Object.values(methods)) {
    if (methodData.INPUTS) {
      for (const input of methodData.INPUTS) {
        for (const value of Object.values(input)) {
          const type = extractTypeFromInput(value);
          if (type) collectStructRefsFromType(type, structRefs);
        }
      }
    }
    
    if (methodData.RETURNS) {
      for (const ret of methodData.RETURNS) {
        if (ret.RETURNTYPE) collectStructRefsFromType(ret.RETURNTYPE, structRefs);
      }
    }
    
    if (methodData.ERRORS) {
      for (const error of methodData.ERRORS) {
        if (error.TYPE) collectStructRefsFromType(error.TYPE, structRefs);
      }
    }
    
    if (methodData.ASYNC?.RESULT?.TYPE) {
      collectStructRefsFromType(methodData.ASYNC.RESULT.TYPE, structRefs);
    }
  }
  
  for (const structName of structRefs) {
    collectStructRecursively(structName, allStructs, requiredStructs, processedStructs);
  }
  
  return requiredStructs;
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
  
  const structFields = allStructs[structName];
  if (Array.isArray(structFields)) {
    for (const field of structFields) {
      if (field.type) {
        const nestedStructNames = extractAllStructNames(field.type);
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
  groupKey: string,
  type: 'http' | 'sdk' | 'other',
  endpoint?: string,
  interfaceName?: string,
  source?: string
): string {
  let cleanName: string;
  
  if (type === 'http' && endpoint) {
    cleanName = sanitizeFilename(endpoint);
  } else if (type === 'sdk') {
    if (interfaceName) {
      cleanName = sanitizeFilename(interfaceName);
      if (source) {
        const cleanSource = sanitizeFilename(source);
        cleanName = `${cleanSource}-${cleanName}`;
      }
    } else if (source) {
      // SDK methods grouped by SOURCE only (no interface name)
      cleanName = sanitizeFilename(source);
    } else {
      // Fallback: use method name from groupKey
      cleanName = sanitizeFilename(groupKey.replace(GROUP_PREFIX_SDK, ''));
    }
  } else {
    cleanName = sanitizeFilename(groupKey.replace(GROUP_PREFIX_OTHER, ''));
  }
  
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

