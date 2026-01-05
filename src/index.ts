// Main entry point for the wrekenfile-converter library (no CLI)
// Default exports use v2 (latest), v1 available via explicit imports

// Re-export v2 as default (when v2 is ready)
// For now, re-export v1 as default to maintain backward compatibility
export * from './v1';

// Explicit version exports
export * as v1 from './v1';
export * as v2 from './v2';

// Export validation function (version-aware)
export { 
  validateWrekenfile,
  fixWrekenfile,
  ValidationResult,
  WrekenfileStructure,
  printValidationResult
} from './v1/wrekenfile-validator';

// Export mini Wrekenfile generator (version-aware)
export { generateMiniWrekenfiles, saveMiniWrekenfiles, MiniWrekenfile } from './v1/mini-wrekenfile-generator';

// Export utility functions
export { 
  getMiniWrekenfilesForEndpoints,
  getMiniWrekenfilesForMethods,
  getMiniWrekenfileContent 
} from './example-usage';

// Export version constants
export { 
  WREKENFILE_V1_VERSION, 
  WREKENFILE_V2_VERSION, 
  DEFAULT_WREKENFILE_VERSION 
} from './versions'; 