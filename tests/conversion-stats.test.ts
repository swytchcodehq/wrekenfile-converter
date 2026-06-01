import { describe, it, expect } from 'vitest';
import { computeConversionStats, formatConversionStats, type ConversionStats } from '../src/v2/utils/conversion-stats';

describe('computeConversionStats', () => {
  it('computes stats for empty wrekenfile', () => {
    const stats = computeConversionStats({ METHODS: {}, STRUCTS: {} });
    expect(stats.methodCount).toBe(0);
    expect(stats.structCount).toBe(0);
    expect(stats.warnings).toEqual([]);
  });

  it('counts methods and returns correctly', () => {
    const wrekenfile = {
      METHODS: {
        'api.pet.list': {
          HTTP: { METHOD: 'GET', HEADERS: {} },
          RETURNS: [{ RETURNTYPE: 'STRUCT(Pet)', STATUS: 200 }],
        },
        'api.pet.create': {
          HTTP: { METHOD: 'POST', HEADERS: { Authorization: 'bearer_token' } },
          INPUTS: [{ body: { TYPE: 'STRUCT(NewPet)' } }],
        },
        'api.pet.delete': {
          HTTP: { METHOD: 'DELETE', HEADERS: { Authorization: 'bearer_token' } },
        },
      },
      STRUCTS: {
        Pet: [{ name: 'id', type: 'INT' }],
        NewPet: [{ name: 'name', type: 'STRING' }],
      },
    };

    const stats = computeConversionStats(wrekenfile);
    expect(stats.methodCount).toBe(3);
    expect(stats.methodsWithReturns).toBe(1);
    expect(stats.methodsWithVoidReturns).toBe(2);
    expect(stats.methodsWithAuth).toBe(2);
    expect(stats.methodsWithInputs).toBe(1);
    expect(stats.structCount).toBe(2);
    expect(stats.httpMethodCounts.GET).toBe(1);
    expect(stats.httpMethodCounts.POST).toBe(1);
    expect(stats.httpMethodCounts.DELETE).toBe(1);
  });

  it('warns about GET endpoints with no returns', () => {
    const wrekenfile = {
      METHODS: {
        'api.pet.list': {
          HTTP: { METHOD: 'GET', HEADERS: {} },
          // No RETURNS
        },
      },
      STRUCTS: {},
    };

    const stats = computeConversionStats(wrekenfile);
    expect(stats.warnings.some(w => w.includes('GET endpoint has no RETURNS'))).toBe(true);
  });

  it('warns when no methods have response types', () => {
    const wrekenfile = {
      METHODS: {
        'api.a': { HTTP: { METHOD: 'POST', HEADERS: {} } },
        'api.b': { HTTP: { METHOD: 'POST', HEADERS: {} } },
      },
      STRUCTS: {},
    };

    const stats = computeConversionStats(wrekenfile);
    expect(stats.warnings.some(w => w.includes('No methods have response types'))).toBe(true);
  });

  it('tracks pruned struct count', () => {
    const wrekenfile = {
      METHODS: {},
      STRUCTS: { A: [], B: [] },
    };

    const stats = computeConversionStats(wrekenfile, 5);
    expect(stats.structsPruned).toBe(3);
    expect(stats.warnings.some(w => w.includes('unused struct'))).toBe(true);
  });
});

describe('formatConversionStats', () => {
  it('formats stats as readable string', () => {
    const stats: ConversionStats = {
      methodCount: 10,
      methodsWithReturns: 8,
      methodsWithVoidReturns: 2,
      methodsWithErrors: 6,
      structCount: 15,
      structsPruned: 3,
      httpMethodCounts: { GET: 5, POST: 3, DELETE: 2 },
      methodsWithAuth: 10,
      methodsWithInputs: 7,
      warnings: ['2 unused struct(s) pruned'],
    };

    const formatted = formatConversionStats(stats);
    expect(formatted).toContain('Methods: 10');
    expect(formatted).toContain('GET: 5');
    expect(formatted).toContain('With response types: 8/10');
    expect(formatted).toContain('Structs: 15');
    expect(formatted).toContain('Warnings');
  });
});
