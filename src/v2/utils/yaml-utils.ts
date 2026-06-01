import { load as yamlLoad, dump } from 'js-yaml';
import {
  YAML_DOCUMENT_SEPARATOR_START,
  YAML_DOCUMENT_SEPARATOR_END,
  YAML_SEPARATOR_LINES,
} from './constants';
import { YAML_DUMP_OPTIONS } from './constants';

const TAB_REPLACEMENT = '  ';
const NEWLINE = '\n';
const DOUBLE_NEWLINE = '\n\n';
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const TAB_REGEX = /\t/g;
const NON_BREAKING_SPACE_REGEX = /[\u00A0]/g;
const CRLF_REGEX = /\r\n/g;
const TRAILING_WHITESPACE_REGEX = /[ \t]+$/gm;
const EXCESSIVE_NEWLINES_REGEX = /\n{3,}/g;
const LEADING_WHITESPACE_REGEX = /^\s+/;
const TRAILING_WHITESPACE_NEWLINES_REGEX = /[\s\n]+$/;

export function cleanYaml(yamlString: string): string {
  let cleaned = yamlString
    .replace(TAB_REGEX, TAB_REPLACEMENT)
    .replace(NON_BREAKING_SPACE_REGEX, ' ')
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(CRLF_REGEX, NEWLINE)
    .replace(TRAILING_WHITESPACE_REGEX, '');

  const lines = cleaned.split(NEWLINE);
  const filteredLines: string[] = [];
  let isFirstLine = true;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === YAML_DOCUMENT_SEPARATOR_START && !isFirstLine) {
      continue;
    }
    if (trimmed === YAML_DOCUMENT_SEPARATOR_END) {
      continue;
    }
    if (YAML_SEPARATOR_LINES.includes(trimmed)) {
      continue;
    }
    
    filteredLines.push(line);
    if (trimmed !== '') {
      isFirstLine = false;
    }
  }
  
  cleaned = filteredLines.join(NEWLINE)
    .replace(EXCESSIVE_NEWLINES_REGEX, DOUBLE_NEWLINE)
    .replace(LEADING_WHITESPACE_REGEX, '')
    .replace(TRAILING_WHITESPACE_NEWLINES_REGEX, '');
  
  if (cleaned) {
    cleaned += NEWLINE;
  }
  
  return cleaned;
}

export function checkYamlForHiddenChars(yamlString: string): void {
  const lines = yamlString.split(NEWLINE);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    if (TAB_REGEX.test(line)) {
      throw new Error(`YAML contains a TAB character at line ${lineNum}:\n${line}`);
    }
    if (NON_BREAKING_SPACE_REGEX.test(line)) {
      throw new Error(`YAML contains a non-breaking space (U+00A0) at line ${lineNum}:\n${line}`);
    }
    if (CONTROL_CHARS_REGEX.test(line)) {
      throw new Error(`YAML contains a non-printable character at line ${lineNum}:\n${line}`);
    }
  }
}

export function validateYaml(yamlString: string): void {
  try {
    yamlLoad(yamlString);
  } catch (e) {
    throw new Error(`Generated YAML is invalid: ${(e as any).message}`);
  }
}

const BLOCK_SCALAR_REGEX = /^(\s+)(-?\s*)(TYPE|RETURNTYPE):\s*\|\-\s*\n(\s+)(\[\]STRUCT\([^)]+\)|\[\][A-Z]+)/gm;
const STRUCT_QUOTED_REGEX = /(TYPE|RETURNTYPE):\s*"STRUCT\(([^)]+)\)"/g;
const ARRAY_TYPE_REGEX = /^(\s+)(-?\s*)(TYPE|RETURNTYPE):\s*(\[\]STRUCT\([^)]+\)|\[\][A-Z]+)(\s*)$/gm;
const QUOTE_START_REGEX = /^["']/;

export function removeTypeQuotes(yamlString: string): string {
  yamlString = yamlString.replace(BLOCK_SCALAR_REGEX, (_match, indent, arrayPrefix, key, _valueIndent, value) => {
    return `${indent}${arrayPrefix}${key}: ${value}`;
  });
  
  yamlString = yamlString.replace(STRUCT_QUOTED_REGEX, '$1: STRUCT($2)');
  
  yamlString = yamlString.replace(ARRAY_TYPE_REGEX, (match, indent, arrayPrefix, key, value, trailing) => {
    if (!QUOTE_START_REGEX.test(value)) {
      return `${indent}${arrayPrefix}${key}: "${value}"${trailing}`;
    }
    return match;
  });
  
  return yamlString;
}

/**
 * Recursively removes undefined values from an object.
 * This prevents js-yaml from generating invalid YAML or unexpected output.
 */
export function removeUndefinedValues(obj: any): any {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  
  if (Array.isArray(obj)) {
    return obj
      .map(item => removeUndefinedValues(item))
      .filter(item => item !== undefined);
  }
  
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeUndefinedValues(value);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }
  
  return obj;
}

/**
 * Complete YAML generation pipeline:
 * 1. Remove undefined values
 * 2. Dump to YAML string
 * 3. Remove type quotes
 * 4. Clean YAML
 * 5. Check for hidden characters
 * 6. Validate YAML
 * 
 * This is the standard pipeline used by all converters.
 */
export function generateYamlString(data: any): string {
  // Remove undefined values before dumping to YAML
  const cleanedData = removeUndefinedValues(data);
  
  // Dump to YAML string
  let yamlString = dump(cleanedData, YAML_DUMP_OPTIONS);
  
  // Post-process to remove quotes from type strings
  yamlString = removeTypeQuotes(yamlString);
  
  // Clean YAML (remove tabs, normalize newlines, etc.)
  yamlString = cleanYaml(yamlString);
  
  // Check for hidden characters
  checkYamlForHiddenChars(yamlString);
  
  // Validate YAML
  validateYaml(yamlString);
  
  return yamlString;
}

