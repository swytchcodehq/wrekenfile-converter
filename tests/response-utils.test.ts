import { describe, it, expect } from 'vitest';
import { generateReturnVarName, generateErrorWhen } from '../src/v2/utils/response-utils';

describe('generateReturnVarName', () => {
  it('generates _result suffix for 200', () => {
    expect(generateReturnVarName('listPets', '200')).toBe('list_pets_result');
  });

  it('includes status code for non-200 success', () => {
    expect(generateReturnVarName('createPet', '201')).toBe('create_pet_201');
  });

  it('handles camelCase operationIds', () => {
    const result = generateReturnVarName('getUserProfile', '200');
    expect(result).toBe('get_user_profile_result');
  });
});

describe('generateErrorWhen', () => {
  it('uses response description when available', () => {
    const result = generateErrorWhen({ description: 'Not found' }, '404');
    expect(result).toBe('Not found (HTTP 404)');
  });

  it('uses well-known HTTP status description for known codes', () => {
    const result = generateErrorWhen(null, '403');
    expect(result).toBe('Forbidden (HTTP 403)');
  });

  it('uses well-known description for 500', () => {
    const result = generateErrorWhen(null, '500');
    expect(result).toBe('Internal Server Error (HTTP 500)');
  });

  it('falls back to HTTP code for other statuses', () => {
    const result = generateErrorWhen(null, '301');
    expect(result).toBe('HTTP 301');
  });

  it('handles undefined response with known code', () => {
    const result = generateErrorWhen(undefined, '404');
    expect(result).toBe('Not Found (HTTP 404)');
  });

  it('handles response with empty description using known status', () => {
    const result = generateErrorWhen({ description: '' }, '400');
    expect(result).toBe('Bad Request (HTTP 400)');
  });

  it('uses well-known descriptions for common 5xx codes', () => {
    expect(generateErrorWhen(null, '502')).toBe('Bad Gateway (HTTP 502)');
    expect(generateErrorWhen(null, '503')).toBe('Service Unavailable (HTTP 503)');
    expect(generateErrorWhen(null, '504')).toBe('Gateway Timeout (HTTP 504)');
  });

  it('falls back to generic for unknown status codes', () => {
    expect(generateErrorWhen(null, '418')).toBe('Client error (HTTP 418)');
    expect(generateErrorWhen(null, '599')).toBe('Server error (HTTP 599)');
  });
});

describe('generateReturnVarName edge cases', () => {
  it('handles single-word operationId', () => {
    const result = generateReturnVarName('list', '200');
    expect(result).toBe('list_result');
  });

  it('handles operationId with consecutive capitals', () => {
    const result = generateReturnVarName('getAPIKeys', '200');
    expect(result).toContain('_result');
  });

  it('handles 202 accepted status', () => {
    const result = generateReturnVarName('deleteUser', '202');
    expect(result).toBe('delete_user_202');
  });

  it('handles 204 no content status', () => {
    const result = generateReturnVarName('deleteUser', '204');
    expect(result).toBe('delete_user_204');
  });
});
