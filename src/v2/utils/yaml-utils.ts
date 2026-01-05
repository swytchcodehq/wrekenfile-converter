import { load as yamlLoad } from 'js-yaml';
import {
  YAML_DOCUMENT_SEPARATOR_START,
  YAML_DOCUMENT_SEPARATOR_END,
  YAML_SEPARATOR_LINES,
} from './constants';

const TAB_REPLACEMENT = '  ';
const NON_BREAKING_SPACE = '\u00A0';
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
  yamlString = yamlString.replace(BLOCK_SCALAR_REGEX, (match, indent, arrayPrefix, key, valueIndent, value) => {
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

