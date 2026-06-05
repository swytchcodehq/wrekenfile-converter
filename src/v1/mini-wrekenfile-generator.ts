import * as yaml from 'js-yaml';
import * as fs from 'fs';

export interface MiniWrekenfile {
  content: string;
  metadata: {
    endpoint: string;
    methods: string[];
    structs: string[];
    filename: string;
  };
}

interface WrekenfileData {
  VERSION: string;
  INIT?: {
    DEFAULTS?: any[];
  };
  INTERFACES: Record<string, any>;
  STRUCTS?: Record<string, any>;
}

/**
 * Generates mini Wrekenfiles by grouping interfaces by endpoint
 * Each mini Wrekenfile contains all methods for a single endpoint plus their required structs
 */
export function generateMiniWrekenfiles(wrekenfileContent: string): MiniWrekenfile[] {
  if (!wrekenfileContent || typeof wrekenfileContent !== 'string') {
    throw new Error("Argument 'wrekenfileContent' is required and must be a string");
  }
  try {
    // Parse the main Wrekenfile from YAML string
    const data = yaml.load(wrekenfileContent) as WrekenfileData;
    
    if (!data.INTERFACES) {
      throw new Error('No INTERFACES section found in Wrekenfile');
    }

    // Group interfaces by endpoint
    const endpointGroups = groupInterfacesByEndpoint(data.INTERFACES);
    
    const miniWrekenfiles: MiniWrekenfile[] = [];
    
    // Generate a mini Wrekenfile for each endpoint group
    for (const [endpoint, interfaces] of Object.entries(endpointGroups)) {
      const miniWrekenfile = createMiniWrekenfile(data, endpoint, interfaces);
      miniWrekenfiles.push(miniWrekenfile);
    }
    
    return miniWrekenfiles;
  } catch (error) {
    console.error('Error generating mini Wrekenfiles:', error);
    throw error;
  }
}

/**
 * Groups interfaces by their endpoint path
 */
function groupInterfacesByEndpoint(interfaces: Record<string, any>): Record<string, Record<string, any>> {
  const groups: Record<string, Record<string, any>> = {};
  
  for (const [interfaceName, interfaceData] of Object.entries(interfaces)) {
    let endpoint = interfaceData.ENDPOINT;
    if (!endpoint) {
      console.warn(`Interface ${interfaceName} has no ENDPOINT, skipping`);
      continue;
    }
    // Normalize endpoint: remove backticks and trim whitespace
    if (typeof endpoint === 'string') {
      endpoint = endpoint.trim();
      if (endpoint.startsWith('`') && endpoint.endsWith('`')) {
        endpoint = endpoint.slice(1, -1).trim();
      }
    }
    if (!groups[endpoint]) {
      groups[endpoint] = {};
    }
    groups[endpoint][interfaceName] = interfaceData;
  }
  
  return groups;
}

/**
 * Creates a complete mini Wrekenfile for a specific endpoint
 */
function createMiniWrekenfile(
  data: WrekenfileData, 
  endpoint: string, 
  interfaces: Record<string, any>
): MiniWrekenfile {
  // Collect all structs referenced by the interfaces in this group
  const requiredStructs = collectRequiredStructs(interfaces, data.STRUCTS || {});
  
  // Create the mini Wrekenfile structure
  const miniData = {
    VERSION: data.VERSION,
    INIT: data.INIT ? { DEFAULTS: data.INIT.DEFAULTS || [] } : undefined,
    INTERFACES: interfaces,
    STRUCTS: requiredStructs
  };
  
  // Convert to YAML
  const content = yaml.dump(miniData, { 
    indent: 2, 
    lineWidth: -1,
    noRefs: true 
  });
  
  // Generate metadata
  const methods = Object.values(interfaces).map((intf: any) => intf.HTTP?.METHOD).filter(Boolean);
  const structNames = Object.keys(requiredStructs);
  const filename = generateFilename(endpoint);
  
  return {
    content,
    metadata: {
      endpoint,
      methods,
      structs: structNames,
      filename
    }
  };
}

/**
 * Collects all structs required by the given interfaces
 */
function collectRequiredStructs(
  interfaces: Record<string, any>, 
  allStructs: Record<string, any>
): Record<string, any> {
  const requiredStructs: Record<string, any> = {};
  const processedStructs = new Set<string>();
  
  // Extract struct references from interfaces
  const structRefs = new Set<string>();
  
  for (const interfaceData of Object.values(interfaces)) {
    // Check INPUTS
    if (interfaceData.INPUTS) {
      for (const input of interfaceData.INPUTS) {
        if (input.type) {
          const structNames = extractAllStructNames(input.type);
          for (const structName of structNames) {
          if (structName) structRefs.add(structName);
          }
        }
      }
    }
    
    // Check RETURNS
    if (interfaceData.RETURNS) {
      for (const ret of interfaceData.RETURNS) {
        if (ret.RETURNTYPE) {
          const structNames = extractAllStructNames(ret.RETURNTYPE);
          for (const structName of structNames) {
          if (structName) structRefs.add(structName);
          }
        }
      }
    }
  }
  
  // Recursively collect all required structs and their dependencies
  for (const structName of structRefs) {
    collectStructRecursively(structName, allStructs, requiredStructs, processedStructs);
  }
  
  return requiredStructs;
}

/**
 * Recursively collects a struct and all its nested struct dependencies
 */
function collectStructRecursively(
  structName: string,
  allStructs: Record<string, any>,
  requiredStructs: Record<string, any>,
  processedStructs: Set<string>
) {
  if (processedStructs.has(structName)) {
    return; // Already processed
  }
  
  processedStructs.add(structName);
  
  if (!allStructs[structName]) {
    console.warn(`Struct ${structName} not found in STRUCTS section`);
    return;
  }
  
  // Add the struct
  requiredStructs[structName] = allStructs[structName];
  
  // Check for nested struct references
  const structFields = allStructs[structName];
  if (Array.isArray(structFields)) {
    for (const field of structFields) {
      if (field.type) {
        // Handle STRUCT(SomeStruct) and []STRUCT(SomeStruct)
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

/**
 * Extracts all struct names from a type string, e.g. STRUCT(SomeStruct), []STRUCT(SomeStruct)
 */
function extractAllStructNames(typeString: string): string[] {
  const matches = [];
  // Match STRUCT(SomeStruct)
  const match1 = typeString.match(/^STRUCT\(([^)]+)\)/);
  if (match1) matches.push(match1[1]);
  // Match []STRUCT(SomeStruct)
  const match2 = typeString.match(/^\[\]STRUCT\(([^)]+)\)/);
  if (match2) matches.push(match2[1]);
  return matches;
}

/**
 * Generates a filename for the mini Wrekenfile
 */
function generateFilename(endpoint: string): string {
  // Clean the endpoint to create a valid filename
  const cleanEndpoint = endpoint
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/\/+$/, '') // Remove trailing slashes
    .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  
  return `mini-${cleanEndpoint}.yaml`;
}

/**
 * Saves mini Wrekenfiles to disk (optional utility function)
 */
export function saveMiniWrekenfiles(miniWrekenfiles: MiniWrekenfile[], outputDir: string = './mini-wrekenfiles'): void {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  for (const miniFile of miniWrekenfiles) {
    const filePath = `${outputDir}/${miniFile.metadata.filename}`;
    fs.writeFileSync(filePath, miniFile.content);
    console.log(`Saved: ${filePath}`);
  }
}

// Only export the main functions at the end. 