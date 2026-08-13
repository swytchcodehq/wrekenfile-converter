import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { createConverterError } from './error-utils';

export class RefResolver {
  private externalRefCache: Record<string, any> = {};
  
  constructor(private baseDir: string, private rootSpec: any) {}

  public resolveRef(ref: string, spec: any = this.rootSpec): any {
    if (!ref || typeof ref !== 'string') {
      throw createConverterError(
        `Invalid $ref: must be a non-empty string`,
        "INVALID_REF",
        { ref, refType: typeof ref }
      );
    }

    if (ref === '#') return spec;

    if (ref.startsWith('#/')) {
      const pathParts = ref.split('/').slice(1);
      let result = spec;
      for (const part of pathParts) {
        const decodedPart = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
        if (result === undefined || result === null || !Object.prototype.hasOwnProperty.call(result, decodedPart)) {
          throw createConverterError(
            `Failed to resolve $ref: ${ref} - path segment '${decodedPart}' not found`,
            "REF_RESOLUTION_FAILED",
            { ref, pathParts, currentPath: pathParts.slice(0, pathParts.indexOf(part) + 1) }
          );
        }
        result = result[decodedPart];
      }
      return result;
    }

    const [filePath, internal] = ref.split('#');
    if (!filePath) {
      throw createConverterError(
        `Invalid external $ref: missing file path in ${ref}`,
        "INVALID_EXTERNAL_REF",
        { ref }
      );
    }

    const fullPath = path.resolve(this.baseDir, filePath);

    if (!fs.existsSync(fullPath)) {
      throw createConverterError(
        `External $ref file not found: ${fullPath}`,
        "EXTERNAL_REF_FILE_NOT_FOUND",
        { ref, filePath, baseDir: this.baseDir, fullPath }
      );
    }

    const realPath = fs.realpathSync(fullPath);
    const realBaseDir = fs.realpathSync(this.baseDir);
    if (!realPath.startsWith(realBaseDir)) {
      throw createConverterError(`External $ref path outside base directory: ${realPath}`, "EXTERNAL_REF_OUTSIDE_BASEDIR", { ref, filePath, baseDir: this.baseDir });
    }

    try {
      if (!this.externalRefCache[fullPath]) {
        const content = fs.readFileSync(fullPath, 'utf8');
        this.externalRefCache[fullPath] = load(content);
      }
      
      if (internal) {
        const internalPath = internal.split('/').slice(1);
        let result = this.externalRefCache[fullPath];
        for (const part of internalPath) {
          const decodedPart = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
          if (result === undefined || result === null || !Object.prototype.hasOwnProperty.call(result, decodedPart)) {
            throw createConverterError(
              `Failed to resolve internal $ref: ${internal} in file ${fullPath}`,
              "REF_INTERNAL_RESOLUTION_FAILED",
              { ref, internal, filePath, internalPath }
            );
          }
          result = result[decodedPart];
        }
        return result;
      }
      return this.externalRefCache[fullPath];
    } catch (err: any) {
      if (err.code && err.code.startsWith('REF_')) {
        throw err;
      }
      throw createConverterError(
        `Error loading external $ref file: ${fullPath}`,
        "EXTERNAL_REF_LOAD_ERROR",
        { ref, filePath, fullPath },
        err
      );
    }
  }
}

/**
 * Deterministically sanitizes a raw identity string for use as a Wrekenfile struct name.
 * If non-alphanumeric characters are stripped, a deterministic hash is appended to prevent
 * data loss and subsequent collisions (e.g. Foo-Bar vs Foo.Bar).
 */
export function sanitizeName(raw: string): string {
  if (!raw) return '';
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, '_');
  if (sanitized === raw) return sanitized;
  
  // Use a simple deterministic hash (djb2) to ensure uniqueness
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) + raw.charCodeAt(i); /* hash * 33 + c */
  }
  // Convert to positive hex string
  const suffix = (hash >>> 0).toString(16);
  return `${sanitized}_${suffix}`;
}

/**
 * Decodes JSON Pointer tokens (~1, ~0) and URI components from a $ref before 
 * returning the sanitized struct name.
 */
export function extractRefName(ref: string): string | undefined {
  if (!ref || typeof ref !== 'string') return undefined;
  const rawTail = ref.split('/').pop();
  if (!rawTail) return undefined;
  
  // Apply JSON Pointer decoding
  const decoded = decodeURIComponent(rawTail.replace(/~1/g, '/').replace(/~0/g, '~'));
  return sanitizeName(decoded);
}
