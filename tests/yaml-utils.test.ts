import { describe, it, expect } from 'vitest';
import {
  cleanYaml,
  checkYamlForHiddenChars,
  validateYaml,
  removeUndefinedValues,
  removeTypeQuotes,
  generateYamlString,
} from '../src/v2/utils/yaml-utils';

describe('cleanYaml', () => {
  it('replaces tabs with spaces', () => {
    const result = cleanYaml('key:\tvalue\n');
    expect(result).not.toContain('\t');
    expect(result).toContain('key:  value');
  });

  it('replaces non-breaking spaces', () => {
    const result = cleanYaml('key:\u00A0value\n');
    expect(result).not.toContain('\u00A0');
  });

  it('normalizes CRLF to LF', () => {
    const result = cleanYaml('line1\r\nline2\r\n');
    expect(result).not.toContain('\r');
  });

  it('removes trailing whitespace from lines', () => {
    const result = cleanYaml('key: value   \nnext: line  \n');
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        expect(line).toBe(line.trimEnd());
      }
    }
  });

  it('collapses excessive newlines', () => {
    const result = cleanYaml('key: value\n\n\n\n\nnext: line\n');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('removes YAML document separators', () => {
    const result = cleanYaml('---\nkey: value\n...\n');
    // First --- is kept if first line, ... is removed
    expect(result).not.toContain('...');
  });

  it('adds trailing newline', () => {
    const result = cleanYaml('key: value');
    expect(result).toMatch(/\n$/);
  });
});

describe('checkYamlForHiddenChars', () => {
  it('passes clean YAML', () => {
    expect(() => checkYamlForHiddenChars('key: value\n')).not.toThrow();
  });

  it('throws on tab character', () => {
    expect(() => checkYamlForHiddenChars('key:\tvalue\n')).toThrow(/TAB/);
  });

  it('throws on non-breaking space', () => {
    expect(() => checkYamlForHiddenChars('key:\u00A0value\n')).toThrow(/non-breaking space/);
  });

  it('throws on control characters', () => {
    expect(() => checkYamlForHiddenChars('key:\x01value\n')).toThrow(/non-printable/);
  });
});

describe('validateYaml', () => {
  it('passes valid YAML', () => {
    expect(() => validateYaml('key: value\n')).not.toThrow();
  });

  it('throws on invalid YAML', () => {
    expect(() => validateYaml('  bad:\n indent: wrong\n')).toThrow();
  });
});

describe('removeUndefinedValues', () => {
  it('removes undefined properties', () => {
    const result = removeUndefinedValues({ a: 1, b: undefined, c: 'hello' });
    expect(result).toEqual({ a: 1, c: 'hello' });
  });

  it('handles nested objects', () => {
    const result = removeUndefinedValues({ a: { b: undefined, c: 1 } });
    expect(result).toEqual({ a: { c: 1 } });
  });

  it('handles arrays', () => {
    const result = removeUndefinedValues([1, undefined, 3]);
    expect(result).toEqual([1, 3]);
  });

  it('returns undefined for null input', () => {
    expect(removeUndefinedValues(null)).toBeUndefined();
  });

  it('passes through primitives', () => {
    expect(removeUndefinedValues(42)).toBe(42);
    expect(removeUndefinedValues('hello')).toBe('hello');
    expect(removeUndefinedValues(true)).toBe(true);
  });

  it('preserves falsy values (0, false, empty string)', () => {
    const result = removeUndefinedValues({ a: 0, b: false, c: '', d: null });
    expect(result).toEqual({ a: 0, b: false, c: '' });
  });

  it('preserves falsy values in arrays', () => {
    const result = removeUndefinedValues([0, false, '', null, undefined, 1]);
    expect(result).toEqual([0, false, '', 1]);
  });

  it('handles deeply nested objects', () => {
    const result = removeUndefinedValues({
      a: { b: { c: { d: undefined, e: 'deep' } } },
    });
    expect(result).toEqual({ a: { b: { c: { e: 'deep' } } } });
  });

  it('handles empty objects and arrays', () => {
    expect(removeUndefinedValues({})).toEqual({});
    expect(removeUndefinedValues([])).toEqual([]);
  });
});

describe('removeTypeQuotes', () => {
  it('removes quotes from STRUCT() types', () => {
    const input = 'TYPE: "STRUCT(User)"';
    const result = removeTypeQuotes(input);
    expect(result).toBe('TYPE: STRUCT(User)');
  });

  it('handles RETURNTYPE with STRUCT', () => {
    const input = 'RETURNTYPE: "STRUCT(Response)"';
    const result = removeTypeQuotes(input);
    expect(result).toBe('RETURNTYPE: STRUCT(Response)');
  });
});

describe('generateYamlString', () => {
  it('generates valid YAML from object', () => {
    const data = {
      VERSION: '2.0.2',
      METHODS: {
        listPets: {
          SUMMARY: 'List all pets',
        },
      },
    };
    const result = generateYamlString(data);
    expect(result).toContain('VERSION:');
    expect(result).toContain('METHODS:');
    expect(result).toContain('listPets:');
    expect(result).toContain('List all pets');
  });

  it('strips undefined values', () => {
    const data = { a: 1, b: undefined };
    const result = generateYamlString(data);
    expect(result).toContain('a:');
    expect(result).not.toContain('b:');
  });

  it('produces parseable YAML', () => {
    const yaml = require('js-yaml');
    const data = { key: 'value', nested: { list: [1, 2, 3] } };
    const result = generateYamlString(data);
    const parsed = yaml.load(result);
    expect(parsed).toEqual(data);
  });
});
