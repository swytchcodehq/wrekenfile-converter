// v2 entry point - Wrekenfile spec version 2.1.0

// Export OpenAPI v3 converter
export { generateWrekenfile } from './openapi-to-wreken';

// Export OpenAPI v2 (Swagger) converter
export { generateWrekenfile as generateWrekenfileV2 } from './openapi-v2-to-wrekenfile';

// Export Postman converter
export { 
  generateWrekenfile as generateWrekenfileFromPostman,
  extractStructs,
  extractOperations,
  mapType,
  parseJsonExample,
  extractFieldsFromObject,
  loadEnvironmentFile,
  extractCollectionVariables,
  resolveVariables
} from './postman-to-wrekenfile';

// Export mini Wrekenfile generator
export { generateMiniWrekenfiles, saveMiniWrekenfiles, MiniWrekenfile } from './mini-wrekenfile-generator';
