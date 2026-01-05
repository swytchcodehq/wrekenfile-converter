import fs from 'fs';
import yaml from 'js-yaml';
import {
  generateWrekenfile,
  generateWrekenfileFromPostman,
  generateMiniWrekenfiles,
  validateWrekenfile
} from './index';
import { MiniWrekenfile } from './v1/mini-wrekenfile-generator';

/**
 * Example usage of the mini Wrekenfile generator
 * This shows how to integrate with a vector database
 */

function exampleUsage() {
  // OpenAPI v3 example
  const openapiContent = fs.readFileSync('./examples/plaid.yml', 'utf8');
  const openapiSpec = yaml.load(openapiContent);
  const wrekenfileYaml = generateWrekenfile(openapiSpec, './examples');
  console.log('OpenAPI v3 to Wrekenfile:', wrekenfileYaml.slice(0, 200) + '...');

  // Postman example
  const postmanContent = fs.readFileSync('./examples/Swytchcode API Docs.postman_collection.json', 'utf8');
  const postmanCollection = JSON.parse(postmanContent);
  const wrekenfileFromPostman = generateWrekenfileFromPostman(postmanCollection, {});
  console.log('Postman to Wrekenfile:', wrekenfileFromPostman.slice(0, 200) + '...');

  // Mini Wrekenfiles
  fs.writeFileSync('./Wrekenfile.yaml', wrekenfileYaml);
  const miniFiles = generateMiniWrekenfiles(wrekenfileYaml);
  console.log('Mini Wrekenfiles count:', miniFiles.length);
  if (miniFiles.length > 0) {
    console.log('First mini Wrekenfile:', miniFiles[0].content.slice(0, 200) + '...');
  }

  // Validation
  const validation = validateWrekenfile('./Wrekenfile.yaml');
  console.log('Validation result:', validation.isValid, validation.errors, validation.warnings);
}

// Example: Function to get mini Wrekenfiles for specific endpoints
export function getMiniWrekenfilesForEndpoints(
  wrekenfileContent: string, 
  targetEndpoints: string[]
): MiniWrekenfile[] {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfileContent);
  
  return allMiniFiles.filter(miniFile => 
    targetEndpoints.includes(miniFile.metadata.endpoint)
  );
}

// Example: Function to get mini Wrekenfiles for specific methods
export function getMiniWrekenfilesForMethods(
  wrekenfileContent: string, 
  targetMethods: string[]
): MiniWrekenfile[] {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfileContent);
  
  return allMiniFiles.filter(miniFile => 
    miniFile.metadata.methods.some(method => 
      targetMethods.includes(method)
    )
  );
}

// Example: Function to get mini Wrekenfile content as string for AI context
export function getMiniWrekenfileContent(
  wrekenfileContent: string, 
  endpoint: string
): string | null {
  const allMiniFiles = generateMiniWrekenfiles(wrekenfileContent);
  
  const miniFile = allMiniFiles.find(
    file => file.metadata.endpoint === endpoint
  );
  
  return miniFile ? miniFile.content : null;
}

// Run example if this file is executed directly
if (require.main === module) {
  exampleUsage();
} 