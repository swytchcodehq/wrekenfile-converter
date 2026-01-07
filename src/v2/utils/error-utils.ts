/**
 * Error handling and logging utilities for v2 converters
 */

export interface ConverterError {
  message: string;
  code: string;
  context?: Record<string, any>;
  cause?: Error;
}

/**
 * Log error with context
 */
export function logError(error: ConverterError | Error, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  
  if (error instanceof Error) {
    console.error(`[${timestamp}] ERROR:`, error.message);
    if (context) {
      console.error('  Context:', JSON.stringify(context, null, 2));
    }
    if (error.stack) {
      console.error('  Stack:', error.stack);
    }
  } else {
    console.error(`[${timestamp}] ERROR [${error.code}]:`, error.message);
    if (error.context) {
      console.error('  Context:', JSON.stringify(error.context, null, 2));
    }
    if (context) {
      console.error('  Additional Context:', JSON.stringify(context, null, 2));
    }
    if (error.cause) {
      console.error('  Caused by:', error.cause.message);
      if (error.cause.stack) {
        console.error('  Cause Stack:', error.cause.stack);
      }
    }
  }
}

/**
 * Create a converter error with context
 */
export function createConverterError(
  message: string,
  code: string,
  context?: Record<string, any>,
  cause?: Error
): ConverterError {
  return { message, code, context, cause };
}

/**
 * Validate OpenAPI v3 spec structure
 */
export function validateOpenApiV3Spec(spec: any): void {
  if (!spec || typeof spec !== 'object') {
    throw createConverterError(
      "Invalid OpenAPI v3 specification: spec must be an object",
      "INVALID_SPEC_TYPE",
      { receivedType: typeof spec }
    );
  }

  if (!spec.openapi) {
    throw createConverterError(
      "Invalid OpenAPI v3 specification: missing 'openapi' field",
      "MISSING_OPENAPI_VERSION",
      { specKeys: Object.keys(spec) }
    );
  }

  const version = parseFloat(spec.openapi);
  if (isNaN(version) || version < 3.0) {
    throw createConverterError(
      `Invalid OpenAPI version: expected 3.x, got ${spec.openapi}`,
      "INVALID_OPENAPI_VERSION",
      { version: spec.openapi }
    );
  }

  if (!spec.info) {
    throw createConverterError(
      "Invalid OpenAPI v3 specification: missing 'info' field",
      "MISSING_INFO",
      { specKeys: Object.keys(spec) }
    );
  }

  if (!spec.paths || typeof spec.paths !== 'object') {
    throw createConverterError(
      "Invalid OpenAPI v3 specification: missing or invalid 'paths' field",
      "MISSING_PATHS",
      { pathsType: typeof spec.paths, specKeys: Object.keys(spec) }
    );
  }
}

/**
 * Validate OpenAPI v2 (Swagger) spec structure
 */
export function validateOpenApiV2Spec(spec: any): void {
  if (!spec || typeof spec !== 'object') {
    throw createConverterError(
      "Invalid OpenAPI v2 specification: spec must be an object",
      "INVALID_SPEC_TYPE",
      { receivedType: typeof spec }
    );
  }

  if (!spec.swagger) {
    throw createConverterError(
      "Invalid OpenAPI v2 specification: missing 'swagger' field",
      "MISSING_SWAGGER_VERSION",
      { specKeys: Object.keys(spec) }
    );
  }

  const version = parseFloat(spec.swagger);
  if (isNaN(version) || version < 2.0 || version >= 3.0) {
    throw createConverterError(
      `Invalid Swagger version: expected 2.x, got ${spec.swagger}`,
      "INVALID_SWAGGER_VERSION",
      { version: spec.swagger }
    );
  }

  if (!spec.info) {
    throw createConverterError(
      "Invalid OpenAPI v2 specification: missing 'info' field",
      "MISSING_INFO",
      { specKeys: Object.keys(spec) }
    );
  }

  if (!spec.paths || typeof spec.paths !== 'object') {
    throw createConverterError(
      "Invalid OpenAPI v2 specification: missing or invalid 'paths' field",
      "MISSING_PATHS",
      { pathsType: typeof spec.paths, specKeys: Object.keys(spec) }
    );
  }
}

/**
 * Validate Postman collection structure
 */
export function validatePostmanCollection(collection: any): void {
  if (!collection || typeof collection !== 'object') {
    throw createConverterError(
      "Invalid Postman collection: collection must be an object",
      "INVALID_COLLECTION_TYPE",
      { receivedType: typeof collection }
    );
  }

  if (!collection.info) {
    throw createConverterError(
      "Invalid Postman collection: missing 'info' field",
      "MISSING_INFO",
      { collectionKeys: Object.keys(collection) }
    );
  }

  if (!collection.item || !Array.isArray(collection.item)) {
    throw createConverterError(
      "Invalid Postman collection: missing or invalid 'item' field (must be an array)",
      "MISSING_ITEMS",
      { itemType: typeof collection.item, collectionKeys: Object.keys(collection) }
    );
  }

  if (collection.item.length === 0) {
    throw createConverterError(
      "Invalid Postman collection: 'item' array is empty",
      "EMPTY_ITEMS",
      { collectionKeys: Object.keys(collection) }
    );
  }
}

/**
 * Validate baseDir parameter
 */
export function validateBaseDir(baseDir: any): void {
  if (!baseDir || typeof baseDir !== 'string') {
    throw createConverterError(
      "Invalid baseDir: must be a non-empty string",
      "INVALID_BASEDIR",
      { receivedType: typeof baseDir, value: baseDir }
    );
  }
}

