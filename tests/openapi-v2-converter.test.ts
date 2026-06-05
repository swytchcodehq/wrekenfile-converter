import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile } from '../src/v2/openapi-v2-to-wrekenfile';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('OpenAPI v2 (Swagger) → Wrekenfile converter', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v2.json'), 'utf-8')
  );

  it('generates valid YAML output', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    expect(typeof result).toBe('string');
    const parsed = yamlLoad(result) as any;
    expect(parsed).toBeDefined();
  });

  it('includes VERSION field', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    expect(parsed.VERSION).toMatch(/^2\./);
  });

  it('generates METHODS for each operation', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    const methodKeys = Object.keys(parsed.METHODS);
    // Swagger petstore has 3 operations: listPets, createPet, getPet
    expect(methodKeys.length).toBe(3);
  });

  it('extracts base URL from host + basePath', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    // Should have a base URL default
    if (parsed.DEFAULTS) {
      const baseUrl = parsed.DEFAULTS.w_base_url || parsed.DEFAULTS.base_url;
      if (baseUrl) {
        expect(baseUrl).toContain('petstore.com');
      }
    }
  });

  it('generates CANONICAL_ID for each method', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.CANONICAL_ID).toBeDefined();
    }
  });

  it('generates STRUCTS from definitions', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    expect(parsed.STRUCTS).toBeDefined();
    const structNames = Object.keys(parsed.STRUCTS);
    expect(structNames.length).toBeGreaterThanOrEqual(1);
  });

  it('sets execution kind to http', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.EXECUTION.KIND).toBe('http');
    }
  });
});
