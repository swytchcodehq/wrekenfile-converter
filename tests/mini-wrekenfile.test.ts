import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { generateMiniWrekenfiles } from '../src/v2/mini-wrekenfile-generator';
import { generateWrekenfile } from '../src/v2/openapi-to-wreken';
import { load as yamlLoad } from 'js-yaml';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Mini-Wrekenfile generator', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3.json'), 'utf-8')
  );
  const wrekenfileContent = generateWrekenfile(spec, FIXTURES_DIR);

  it('generates one mini-wrekenfile per method', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    // Petstore has 5 operations
    expect(minis.length).toBe(5);
  });

  it('each mini-wrekenfile has a filename in metadata', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    for (const mini of minis) {
      expect(mini.metadata.filename).toBeDefined();
      expect(mini.metadata.filename.length).toBeGreaterThan(0);
    }
  });

  it('each mini-wrekenfile has content', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    for (const mini of minis) {
      expect(mini.content).toBeDefined();
      expect(mini.content.length).toBeGreaterThan(0);
    }
  });

  it('each mini-wrekenfile content is valid YAML', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    for (const mini of minis) {
      const parsed = yamlLoad(mini.content);
      expect(parsed).toBeDefined();
    }
  });

  it('each mini-wrekenfile includes VERSION', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    for (const mini of minis) {
      const parsed = yamlLoad(mini.content) as any;
      expect(parsed.VERSION).toBeDefined();
    }
  });

  it('each mini-wrekenfile includes exactly one METHOD', () => {
    const minis = generateMiniWrekenfiles(wrekenfileContent);
    for (const mini of minis) {
      const parsed = yamlLoad(mini.content) as any;
      if (parsed.METHODS) {
        expect(Object.keys(parsed.METHODS).length).toBe(1);
      }
    }
  });

  it('throws on empty input', () => {
    expect(() => generateMiniWrekenfiles('')).toThrow();
  });

  it('throws on non-string input', () => {
    expect(() => generateMiniWrekenfiles(null as any)).toThrow();
  });
});
