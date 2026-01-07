import fs from 'fs';
import yaml from 'js-yaml';
import * as v1 from './v1';
import * as v2 from './v2';
import { validateWrekenfile } from './v1/wrekenfile-validator';
import { generateMiniWrekenfiles as generateMiniWrekenfilesV1, MiniWrekenfile as MiniWrekenfileV1 } from './v1/mini-wrekenfile-generator';
import { generateMiniWrekenfiles as generateMiniWrekenfilesV2, MiniWrekenfile as MiniWrekenfileV2 } from './v2/mini-wrekenfile-generator';

/**
 * Example usage of the Wrekenfile converters and mini-wrekenfile generator
 * This shows how to use both v1 and v2 converters
 */

function exampleUsageV1() {
  console.log('=== Wrekenfile v1 Examples ===');
  
  // OpenAPI v3 example (v1)
  const openapiContent = fs.readFileSync('./examples/plaid.yml', 'utf8');
  const openapiSpec = yaml.load(openapiContent);
  const wrekenfileYaml = v1.generateWrekenfile(openapiSpec, './examples');
  console.log('OpenAPI v3 to Wrekenfile (v1):', wrekenfileYaml.slice(0, 200) + '...');

  // Postman example (v1)
  const postmanContent = fs.readFileSync('./examples/Swytchcode API Docs.postman_collection.json', 'utf8');
  const postmanCollection = JSON.parse(postmanContent);
  const wrekenfileFromPostman = v1.generateWrekenfileFromPostman(postmanCollection, {});
  console.log('Postman to Wrekenfile (v1):', wrekenfileFromPostman.slice(0, 200) + '...');

  // Mini Wrekenfiles (v1)
  fs.writeFileSync('./Wrekenfile.yaml', wrekenfileYaml);
  const miniFiles = generateMiniWrekenfilesV1(wrekenfileYaml);
  console.log('Mini Wrekenfiles count (v1):', miniFiles.length);
  if (miniFiles.length > 0) {
    console.log('First mini Wrekenfile (v1):', miniFiles[0].content.slice(0, 200) + '...');
  }
}

function exampleUsageV2() {
  console.log('=== Wrekenfile v2 Examples ===');
  
  try {
    // OpenAPI v3 example (v2)
    const openapiContent = fs.readFileSync('./examples/3n.yaml', 'utf8');
    const openapiSpec = yaml.load(openapiContent);
    const wrekenfileYaml = v2.generateWrekenfile(openapiSpec, './examples');
    console.log('OpenAPI v3 to Wrekenfile (v2):', wrekenfileYaml.slice(0, 200) + '...');
    const parsed = yaml.load(wrekenfileYaml) as any;
    console.log('  Generated:', Object.keys(parsed.METHODS || {}).length, 'methods');

    // OpenAPI v2 (Swagger) example (v2)
    const openapiV2Content = fs.readFileSync('./examples/5n_v2.yaml', 'utf8');
    const openapiV2Spec = yaml.load(openapiV2Content);
    const wrekenfileV2Yaml = v2.generateWrekenfileV2(openapiV2Spec, './examples');
    console.log('OpenAPI v2 to Wrekenfile (v2):', wrekenfileV2Yaml.slice(0, 200) + '...');
    const parsedV2 = yaml.load(wrekenfileV2Yaml) as any;
    console.log('  Generated:', Object.keys(parsedV2.METHODS || {}).length, 'methods');

    // Postman example (v2)
    const postmanContent = fs.readFileSync('./examples/Nium APIpostman_collection.json', 'utf8');
    const postmanCollection = JSON.parse(postmanContent);
    const wrekenfileFromPostman = v2.generateWrekenfileFromPostman(postmanCollection, {});
    console.log('Postman to Wrekenfile (v2):', wrekenfileFromPostman.slice(0, 200) + '...');
    const parsedPostman = yaml.load(wrekenfileFromPostman) as any;
    console.log('  Generated:', Object.keys(parsedPostman.METHODS || {}).length, 'methods');

    // Mini Wrekenfiles (v2) - supports both HTTP and SDK methods
    fs.writeFileSync('./Wrekenfile_v2.yaml', wrekenfileYaml);
    const miniFiles = generateMiniWrekenfilesV2(wrekenfileYaml);
    console.log('Mini Wrekenfiles count (v2):', miniFiles.length);
    if (miniFiles.length > 0) {
      const firstMini = miniFiles[0];
      console.log('First mini Wrekenfile (v2):', firstMini.content.slice(0, 200) + '...');
      console.log('  Metadata:', {
        endpoint: firstMini.metadata.endpoint,
        interface: firstMini.metadata.interface,
        source: firstMini.metadata.source,
        methods: firstMini.metadata.methods,
        structs: firstMini.metadata.structs
      });
    }

    // Validation
    const validation = validateWrekenfile('./Wrekenfile_v2.yaml');
    console.log('Validation result:', validation.isValid, validation.errors, validation.warnings);
  } catch (err: any) {
    console.error('Error in v2 examples:', err.message);
    if (err.code) {
      console.error('  Error code:', err.code);
    }
    throw err;
  }
}

function exampleUsage() {
  exampleUsageV1();
  console.log('\n');
  exampleUsageV2();
}

// Example: Function to get mini Wrekenfiles for specific endpoints (v1)
export function getMiniWrekenfilesForEndpoints(
  wrekenfileContent: string, 
  targetEndpoints: string[]
): MiniWrekenfileV1[] {
  const allMiniFiles = generateMiniWrekenfilesV1(wrekenfileContent);
  
  return allMiniFiles.filter((miniFile: MiniWrekenfileV1) => 
    targetEndpoints.includes(miniFile.metadata.endpoint || '')
  );
}

// Example: Function to get mini Wrekenfiles for specific endpoints (v2)
export function getMiniWrekenfilesForEndpointsV2(
  wrekenfileContent: string, 
  targetEndpoints: string[]
): MiniWrekenfileV2[] {
  const allMiniFiles = generateMiniWrekenfilesV2(wrekenfileContent);
  
  return allMiniFiles.filter((miniFile: MiniWrekenfileV2) => 
    miniFile.metadata.endpoint && targetEndpoints.includes(miniFile.metadata.endpoint)
  );
}

// Example: Function to get mini Wrekenfiles for specific methods (v1)
export function getMiniWrekenfilesForMethods(
  wrekenfileContent: string, 
  targetMethods: string[]
): MiniWrekenfileV1[] {
  const allMiniFiles = generateMiniWrekenfilesV1(wrekenfileContent);
  
  return allMiniFiles.filter((miniFile: MiniWrekenfileV1) => 
    miniFile.metadata.methods.some((method: string) => 
      targetMethods.includes(method)
    )
  );
}

// Example: Function to get mini Wrekenfiles for specific methods (v2)
export function getMiniWrekenfilesForMethodsV2(
  wrekenfileContent: string, 
  targetMethods: string[]
): MiniWrekenfileV2[] {
  const allMiniFiles = generateMiniWrekenfilesV2(wrekenfileContent);
  
  return allMiniFiles.filter((miniFile: MiniWrekenfileV2) => 
    miniFile.metadata.methods.some((method: string) => 
      targetMethods.includes(method)
    )
  );
}

// Example: Function to get mini Wrekenfiles for SDK interface (v2)
export function getMiniWrekenfilesForInterface(
  wrekenfileContent: string, 
  interfaceName: string,
  source?: string
): MiniWrekenfileV2[] {
  const allMiniFiles = generateMiniWrekenfilesV2(wrekenfileContent);
  
  return allMiniFiles.filter((miniFile: MiniWrekenfileV2) => 
    miniFile.metadata.interface === interfaceName &&
    (!source || miniFile.metadata.source === source)
  );
}

// Example: Function to get mini Wrekenfile content as string for AI context (v1)
export function getMiniWrekenfileContent(
  wrekenfileContent: string, 
  endpoint: string
): string | null {
  const allMiniFiles = generateMiniWrekenfilesV1(wrekenfileContent);
  
  const miniFile = allMiniFiles.find(
    (file: MiniWrekenfileV1) => file.metadata.endpoint === endpoint
  );
  
  return miniFile ? miniFile.content : null;
}

// Example: Function to get mini Wrekenfile content as string for AI context (v2)
export function getMiniWrekenfileContentV2(
  wrekenfileContent: string, 
  endpoint?: string,
  interfaceName?: string,
  source?: string
): string | null {
  const allMiniFiles = generateMiniWrekenfilesV2(wrekenfileContent);
  
  const miniFile = allMiniFiles.find((file: MiniWrekenfileV2) => {
    if (endpoint && file.metadata.endpoint !== endpoint) return false;
    if (interfaceName && file.metadata.interface !== interfaceName) return false;
    if (source && file.metadata.source !== source) return false;
    return true;
  });
  
  return miniFile ? miniFile.content : null;
}

// Run example if this file is executed directly
if (require.main === module) {
  exampleUsage();
} 