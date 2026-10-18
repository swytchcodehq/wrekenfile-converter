// v2 entry point - Wrekenfile spec version 2.1.0

// Export OpenAPI v3 converter
export { generateWrekenfile, generateWrekenfileWithStats } from './openapi-to-wreken';

// Export OpenAPI v2 (Swagger) converter
export { generateWrekenfile as generateWrekenfileV2, generateWrekenfileWithStats as generateWrekenfileV2WithStats } from './openapi-v2-to-wrekenfile';

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
  resolveVariables,
  type PostmanConvertOptions,
} from './postman-to-wrekenfile';

// Export request-signing constants (Wrekenfile 2.1.0 SIGNING / request_signature)
export { SIGNING_EXTENSION, REQUEST_SIGNATURE_TYPE, ROOT_RECIPE_NAME } from './utils/signing-utils';

// Export mini Wrekenfile generator
export { generateMiniWrekenfiles, saveMiniWrekenfiles, MiniWrekenfile } from './mini-wrekenfile-generator';

// Export canonical ID utilities (deterministic method naming)
export {
  computeCanonicalId,
  resolveCanonicalIds,
  type MethodCanonicalInput,
} from './utils/canonical-id';

// Export conversion stats utilities
export {
  computeConversionStats,
  formatConversionStats,
  type ConversionStats,
} from './utils/conversion-stats';
