/**
 * Shared type utilities for v2 converters
 */

/**
 * Primitive type definition
 */
export type Primitive = 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'TIMESTAMP' | 'DATE' | 'TIME' | 'NULL' | 'UNDEFINED' | 'VOID' | 'ANY' | 'OBJECT';

/**
 * Map OpenAPI type and format to Wrekenfile primitive type
 * Used by both OpenAPI v2 and v3 converters
 */
export function mapOpenApiType(type: any, format?: string): Primitive {
  if (format === 'uuid') return 'STRING'; // UUID is typically a string
  if (format === 'date-time') return 'TIMESTAMP';
  if (format === 'date') return 'DATE';
  if (format === 'time') return 'TIME';
  if (format === 'binary') return 'STRING'; // File uploads
  if (typeof type === 'string') {
    const t = type.toLowerCase();
    if (t === 'string') return 'STRING';
    if (t === 'integer' || t === 'int') return 'INT';
    if (t === 'number') return 'FLOAT';
    if (t === 'boolean' || t === 'bool') return 'BOOL';
    if (t === 'null') return 'NULL';
    return 'ANY';
  }
  // Handle array of types (OpenAPI allows type: ['string', 'null'])
  if (Array.isArray(type) && type.length > 0 && typeof type[0] === 'string') {
    const t = type[0].toLowerCase();
    if (t === 'string') return 'STRING';
    if (t === 'integer' || t === 'int') return 'INT';
    if (t === 'number') return 'FLOAT';
    if (t === 'boolean' || t === 'bool') return 'BOOL';
    return 'ANY';
  }
  // Fallback for missing or unexpected type
  return 'ANY';
}

