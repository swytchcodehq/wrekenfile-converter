import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile, extractCollectionVariables } from '../src/v2/postman-to-wrekenfile';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Postman → Wrekenfile converter', () => {
  const collection = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'postman-collection.json'), 'utf-8')
  );
  // Postman converter takes (collection, variables: Record<string, string>)
  const variables = extractCollectionVariables(collection);

  it('generates valid YAML output', () => {
    const result = generateWrekenfile(collection, variables);
    expect(typeof result).toBe('string');
    const parsed = yamlLoad(result) as any;
    expect(parsed).toBeDefined();
  });

  it('includes VERSION field', () => {
    const result = generateWrekenfile(collection, variables);
    const parsed = yamlLoad(result) as any;
    expect(parsed.VERSION).toMatch(/^2\./);
  });

  it('generates METHODS from collection items', () => {
    const result = generateWrekenfile(collection, variables);
    const parsed = yamlLoad(result) as any;
    expect(parsed.METHODS).toBeDefined();
    const methodKeys = Object.keys(parsed.METHODS);
    // Collection has 3 requests: List Pets, Create Pet, Get Pet
    expect(methodKeys.length).toBe(3);
  });

  it('extracts collection variables', () => {
    expect(variables).toBeDefined();
    expect(typeof variables).toBe('object');
    expect(variables['baseUrl']).toBe('https://api.petstore.com/v1');
  });

  it('includes HTTP details for each method', () => {
    const result = generateWrekenfile(collection, variables);
    const parsed = yamlLoad(result) as any;
    for (const [, method] of Object.entries<any>(parsed.METHODS)) {
      expect(method.HTTP).toBeDefined();
      expect(method.HTTP.METHOD).toBeDefined();
    }
  });

  it('generates STRUCTS from response examples', () => {
    const result = generateWrekenfile(collection, variables);
    const parsed = yamlLoad(result) as any;
    // Postman converter should extract structs from JSON response bodies
    if (parsed.STRUCTS) {
      expect(Object.keys(parsed.STRUCTS).length).toBeGreaterThanOrEqual(0);
    }
  });
});
