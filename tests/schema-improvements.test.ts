import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile, generateWrekenfileWithStats } from '../src/v2/openapi-to-wreken';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('oneOf/anyOf handling', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3-extended.json'), 'utf-8')
  );

  it('creates struct with discriminator and variant refs for oneOf schema', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // PetInput uses oneOf with discriminator — variants are on PetInput directly
    const petInputStruct = parsed.STRUCTS?.PetInput;
    expect(petInputStruct).toBeDefined();

    // Should have the discriminator field
    const discriminatorField = petInputStruct.find((f: any) => f.name === 'petType');
    expect(discriminatorField).toBeDefined();
    expect(discriminatorField.type).toBe('STRING');
    expect(discriminatorField.REQUIRED).toBe(true);

    // Should have variant references to Cat and Dog
    const catVariant = petInputStruct.find((f: any) => f.name === 'variant_Cat');
    expect(catVariant).toBeDefined();
    expect(catVariant.type).toBe('STRUCT(Cat)');

    const dogVariant = petInputStruct.find((f: any) => f.name === 'variant_Dog');
    expect(dogVariant).toBeDefined();
    expect(dogVariant.type).toBe('STRUCT(Dog)');
  });

  it('creates union struct with primitive type variants (anyOf)', () => {
    // Reference MixedType from an operation so filterStructsByUsage doesn't prune it
    const specWithMixedTypeReference = {
      ...spec,
      paths: {
        ...spec.paths,
        '/mixed-type-test': {
          get: {
            operationId: 'getMixedType',
            responses: {
              '200': {
                description: 'MixedType response',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/MixedType' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = generateWrekenfile(specWithMixedTypeReference, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // MixedType uses anyOf with string and integer — variants are on MixedType directly
    const mixedType = parsed.STRUCTS?.MixedType;
    expect(mixedType).toBeDefined();

    const stringVariant = mixedType.find((f: any) => f.name === 'variant_0');
    expect(stringVariant).toBeDefined();
    expect(stringVariant.type).toBe('STRING');

    const integerVariant = mixedType.find((f: any) => f.name === 'variant_1');
    expect(integerVariant).toBeDefined();
    expect(integerVariant.type).toBe('INT');
  });

  it('includes Cat and Dog structs referenced by union variants', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // Cat struct should exist and have proper fields
    const catStruct = parsed.STRUCTS?.Cat;
    expect(catStruct).toBeDefined();
    const catNames = catStruct.map((f: any) => f.name);
    expect(catNames).toContain('petType');
    expect(catNames).toContain('name');
    expect(catNames).toContain('indoor');

    // Dog struct should exist
    const dogStruct = parsed.STRUCTS?.Dog;
    expect(dogStruct).toBeDefined();
    const dogNames = dogStruct.map((f: any) => f.name);
    expect(dogNames).toContain('breed');
  });
});

describe('error schema references', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3-extended.json'), 'utf-8')
  );

  it('references ErrorResponse struct in ERRORS', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    // Find the listPets method (uses canonical ID)
    const listPetsMethod = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.HTTP?.METHOD === 'GET' && m.HTTP?.ENDPOINT === '/pets'
    );
    expect(listPetsMethod).toBeDefined();
    expect(listPetsMethod.ERRORS).toBeDefined();
    expect(listPetsMethod.ERRORS.length).toBeGreaterThanOrEqual(1);

    // At least one error should reference ErrorResponse struct
    const hasErrorStruct = listPetsMethod.ERRORS.some(
      (e: any) => e.TYPE === 'STRUCT(ErrorResponse)'
    );
    expect(hasErrorStruct).toBe(true);
  });

  it('includes ErrorResponse in STRUCTS', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    const errorStruct = parsed.STRUCTS?.ErrorResponse;
    expect(errorStruct).toBeDefined();
    const fieldNames = errorStruct.map((f: any) => f.name);
    expect(fieldNames).toContain('code');
    expect(fieldNames).toContain('message');
    expect(fieldNames).toContain('details');
  });

  it('uses specific WHEN descriptions from spec', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    const listPetsMethod = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.HTTP?.METHOD === 'GET' && m.HTTP?.ENDPOINT === '/pets'
    );

    const error400 = listPetsMethod?.ERRORS?.find((e: any) => e.STATUS === 400);
    expect(error400?.WHEN).toContain('Validation failed');

    const error500 = listPetsMethod?.ERRORS?.find((e: any) => e.STATUS === 500);
    expect(error500?.WHEN).toContain('Unexpected server error');
  });
});

describe('conversion stats', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3-extended.json'), 'utf-8')
  );

  it('returns correct method count', () => {
    const { stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(stats.methodCount).toBe(3); // listPets, createPet, getPet
  });

  it('tracks methods with returns vs void', () => {
    const { stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(stats.methodsWithReturns).toBeGreaterThan(0);
    expect(stats.methodsWithReturns + stats.methodsWithVoidReturns).toBe(stats.methodCount);
  });

  it('counts HTTP methods', () => {
    const { stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(stats.httpMethodCounts.GET).toBe(2);
    expect(stats.httpMethodCounts.POST).toBe(1);
  });

  it('tracks struct count', () => {
    const { stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(stats.structCount).toBeGreaterThan(0);
  });

  it('tracks methods with errors', () => {
    const { stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(stats.methodsWithErrors).toBeGreaterThan(0);
  });

  it('generates valid YAML alongside stats', () => {
    const { yaml, stats } = generateWrekenfileWithStats(spec, FIXTURES_DIR);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
    const parsed = yamlLoad(yaml) as any;
    expect(parsed.VERSION).toBeDefined();
    expect(stats.methodCount).toBe(Object.keys(parsed.METHODS).length);
  });
});

describe('well-known error descriptions', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'petstore-v3-extended.json'), 'utf-8')
  );

  it('uses Not Found for 404 without spec description', () => {
    const result = generateWrekenfile(spec, FIXTURES_DIR);
    const parsed = yamlLoad(result) as any;

    const getPetMethod = Object.values<any>(parsed.METHODS).find(
      (m: any) => m.HTTP?.METHOD === 'GET' && m.HTTP?.ENDPOINT === '/pets/{petId}'
    );

    // The 404 has description "Pet not found" in spec, so it uses that
    const error404 = getPetMethod?.ERRORS?.find((e: any) => e.STATUS === 404);
    expect(error404?.WHEN).toContain('Pet not found');
  });
});
