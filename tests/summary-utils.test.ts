import { describe, it, expect } from 'vitest';
import { generateOpenApiSummary } from '../src/v2/utils/summary-utils';

describe('generateOpenApiSummary', () => {
  it('returns operation summary when present', () => {
    const op = { summary: 'List all pets' };
    expect(generateOpenApiSummary(op, 'get', '/pets')).toBe('List all pets');
  });

  it('uses first sentence of description as fallback', () => {
    const op = { description: 'Gets all users from the database. Supports pagination.' };
    const result = generateOpenApiSummary(op, 'get', '/users');
    expect(result).toBe('Gets all users from the database');
  });

  it('uses operationId when no summary or description', () => {
    const op = { operationId: 'listPets' };
    expect(generateOpenApiSummary(op, 'get', '/pets')).toContain('listPets');
  });

  it('generates from HTTP method and path as last resort', () => {
    const result = generateOpenApiSummary({}, 'get', '/users');
    expect(result).toBe('Fetch Users');
  });

  it('generates correct verb for POST', () => {
    const result = generateOpenApiSummary({}, 'post', '/users');
    expect(result).toBe('Create Users');
  });

  it('generates correct verb for DELETE', () => {
    const result = generateOpenApiSummary({}, 'delete', '/users/{id}');
    expect(result).toBe('Delete Users');
  });
});
