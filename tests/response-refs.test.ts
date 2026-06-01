import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile } from '../src/v2/openapi-to-wreken';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Response-level $ref resolution', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'response-refs.json'), 'utf-8')
  );

  it('resolves response $refs and produces STRUCT return types', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // listItems should have a RETURNS entry with a STRUCT type (not VOID)
    const listItems = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.SUMMARY === 'List items'
    );
    expect(listItems).toBeDefined();
    expect(listItems.RETURNS).toBeDefined();
    expect(listItems.RETURNS.length).toBeGreaterThan(0);
    expect(listItems.RETURNS[0].RETURNTYPE).not.toBe('VOID');

    // getItem should return STRUCT(Item)
    const getItem = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.SUMMARY === 'Get item by ID'
    );
    expect(getItem).toBeDefined();
    expect(getItem.RETURNS).toBeDefined();
    expect(getItem.RETURNS[0].RETURNTYPE).toBe('STRUCT(Item)');
  });

  it('resolves error response $refs with descriptions', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    const listItems = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.SUMMARY === 'List items'
    );
    expect(listItems.ERRORS).toBeDefined();
    expect(listItems.ERRORS.length).toBeGreaterThanOrEqual(2);

    // Should have descriptive WHEN from resolved response description
    const err400 = listItems.ERRORS.find((e: any) => e.STATUS === 400);
    expect(err400).toBeDefined();
    expect(err400.WHEN).toContain('Invalid request');
  });

  it('populates STRUCTS from response schemas', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    expect(parsed.STRUCTS).toBeDefined();
    const structNames = Object.keys(parsed.STRUCTS);

    // Item schema should be in STRUCTS (referenced by response $refs)
    expect(structNames).toContain('Item');
  });
});
