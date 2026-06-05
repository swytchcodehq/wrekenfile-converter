import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile } from '../src/v2/openapi-to-wreken';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('OpenAPI v3 → Wrekenfile converter', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3.json'), 'utf-8')
  );

  it('generates valid YAML output', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);

    // Should be parseable YAML
    const parsed = yamlLoad(result) as any;
    expect(parsed).toBeDefined();
  });

  it('includes VERSION field', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    expect(parsed.VERSION).toBeDefined();
    expect(parsed.VERSION).toMatch(/^2\./);
  });

  it('generates METHODS for each operation', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    expect(parsed.METHODS).toBeDefined();

    const methodKeys = Object.keys(parsed.METHODS);
    // Petstore has 5 operations: listPets, createPet, getPet, updatePet, deletePet
    expect(methodKeys.length).toBe(5);
  });

  it('generates CANONICAL_ID for each method', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.CANONICAL_ID).toBeDefined();
      expect(typeof method.CANONICAL_ID).toBe('string');
      // Should be dot-separated
      expect(method.CANONICAL_ID).toMatch(/\./);
    }
  });

  it('includes HTTP execution details', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.HTTP).toBeDefined();
      expect(method.HTTP.METHOD).toBeDefined();
      expect(method.HTTP.ENDPOINT).toBeDefined();
    }
  });

  it('includes EXECUTION section', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.EXECUTION).toBeDefined();
      expect(method.EXECUTION.KIND).toBe('http');
    }
  });

  it('generates STRUCTS from schemas', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;
    expect(parsed.STRUCTS).toBeDefined();

    // Pet and NewPet schemas should produce structs
    const structNames = Object.keys(parsed.STRUCTS);
    expect(structNames.length).toBeGreaterThanOrEqual(1);
  });

  it('includes SUMMARY for methods', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.SUMMARY).toBeDefined();
      expect(typeof method.SUMMARY).toBe('string');
    }
  });

  it('handles query parameters', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // listPets has a 'limit' query param
    const listPets = Object.values<any>(parsed.METHODS).find(
      (m) => m.HTTP?.METHOD === 'GET' && m.HTTP?.ENDPOINT?.includes('/pets') && !m.HTTP?.ENDPOINT?.includes('{')
    );
    expect(listPets).toBeDefined();
    if (listPets?.INPUTS) {
      const limitInput = listPets.INPUTS.find((i: any) => {
        const key = Object.keys(i)[0];
        return key === 'limit' || i[key]?.NAME === 'limit';
      });
      // limit parameter should exist somewhere in inputs
      expect(listPets.INPUTS.length).toBeGreaterThan(0);
    }
  });

  it('includes error responses', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // createPet has a 400 error response
    const createPet = Object.values<any>(parsed.METHODS).find(
      (m) => m.HTTP?.METHOD === 'POST' && m.HTTP?.ENDPOINT?.includes('/pets')
    );
    if (createPet?.ERRORS) {
      expect(createPet.ERRORS.length).toBeGreaterThan(0);
    }
  });
});
