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
export function generateMiniWrekenfiles(wrekenfilePath: string): MiniWrekenfile[] {
  try {
    // Read and parse the main Wrekenfile
    const fileContent = fs.readFileSync(wrekenfilePath, 'utf8');
    const data = yaml.load(fileContent) as WrekenfileData;
    
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
    const endpoint = interfaceData.ENDPOINT;
    if (!endpoint) {
      console.warn(`Interface ${interfaceName} has no ENDPOINT, skipping`);
      continue;
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
        if (input.type && input.type.startsWith('STRUCT(')) {
          const structName = extractStructName(input.type);
          if (structName) structRefs.add(structName);
        }
      }
    }
    
    // Check RETURNS
    if (interfaceData.RETURNS) {
      for (const ret of interfaceData.RETURNS) {
        if (ret.RETURNTYPE && ret.RETURNTYPE.startsWith('STRUCT(')) {
          const structName = extractStructName(ret.RETURNTYPE);
          if (structName) structRefs.add(structName);
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
      if (field.type && field.type.startsWith('STRUCT(')) {
        const nestedStructName = extractStructName(field.type);
        if (nestedStructName) {
          collectStructRecursively(nestedStructName, allStructs, requiredStructs, processedStructs);
        }
      }
    }
  }
}

/**
 * Extracts struct name from STRUCT(name) format
 */
function extractStructName(typeString: string): string | null {
  const match = typeString.match(/^STRUCT\(([^)]+)\)/);
  return match ? match[1] : null;
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

/**
 * CLI function for testing
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node mini-wrekenfile-generator.js <wrekenfile-path> [output-dir]');
    process.exit(1);
  }
  
  const wrekenfilePath = args[0];
  const outputDir = args[1] || './mini-wrekenfiles';
  
  try {
    const miniFiles = generateMiniWrekenfiles(wrekenfilePath);
    console.log(`Generated ${miniFiles.length} mini Wrekenfiles`);
    
    // Save to disk
    saveMiniWrekenfiles(miniFiles, outputDir);
    
    // Print metadata
    for (const miniFile of miniFiles) {
      console.log(`\n${miniFile.metadata.filename}:`);
      console.log(`  Endpoint: ${miniFile.metadata.endpoint}`);
      console.log(`  Methods: ${miniFile.metadata.methods.join(', ')}`);
      console.log(`  Structs: ${miniFile.metadata.structs.length}`);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
} 