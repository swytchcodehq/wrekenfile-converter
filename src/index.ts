// Main entry point for the wrekenfile-converter library (no CLI)

// Export main conversion functions
export { generateWrekenfile } from './openapi-to-wreken';
export { generateWrekenfile as generateWrekenfileV2 } from './openapi-v2-to-wrekenfile';
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

// Export validation function
export { 
  validateWrekenfile,
  fixWrekenfile,
  ValidationResult,
  WrekenfileStructure,
  printValidationResult
} from './wrekenfile-validator';

// Export mini Wrekenfile generator
export { generateMiniWrekenfiles, saveMiniWrekenfiles, MiniWrekenfile } from './mini-wrekenfile-generator';

// Export utility functions
export { 
  getMiniWrekenfilesForEndpoints,
  getMiniWrekenfilesForMethods,
  getMiniWrekenfileContent 
} from './example-usage'; 