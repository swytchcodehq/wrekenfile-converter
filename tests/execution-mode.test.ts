import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile as generateV3Wrekenfile } from '../src/v2/openapi-to-wreken';
import { generateWrekenfile as generateV2Wrekenfile } from '../src/v2/openapi-v2-to-wrekenfile';
import { generateWrekenfile as generatePostmanWrekenfile } from '../src/v2/postman-to-wrekenfile';

describe('EXECUTION MODE detection', () => {
  it('assigns sync mode by default', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'sync-api', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/test': {
          get: { operationId: 'TestSync', responses: { '200': { description: 'ok' } } },
        },
      },
    };
    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    expect(Object.values<any>(parsed.METHODS)[0].EXECUTION.MODE).toBe('sync');
  });

  it('assigns async mode when 202 is present in OpenAPI v3', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'async-api', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/test': {
          get: { operationId: 'TestAsync', responses: { '202': { description: 'accepted' } } },
        },
      },
    };
    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    expect(Object.values<any>(parsed.METHODS)[0].EXECUTION.MODE).toBe('async');
  });

  it('assigns async mode when callbacks are present in OpenAPI v3', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'async-api', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/test': {
          get: { 
            operationId: 'TestAsync', 
            responses: { '200': { description: 'ok' } },
            callbacks: { myCallback: {} }
          },
        },
      },
    };
    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    expect(Object.values<any>(parsed.METHODS)[0].EXECUTION.MODE).toBe('async');
  });

  it('assigns async mode when 202 is present in Swagger v2', () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'async-api', version: '1.0' },
      host: 'example.com',
      basePath: '/',
      paths: {
        '/test': {
          get: { operationId: 'TestAsync', responses: { '202': { description: 'accepted' } } },
        },
      },
    };
    const result = generateV2Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    expect(Object.values<any>(parsed.METHODS)[0].EXECUTION.MODE).toBe('async');
  });

  it('assigns async mode when 202 is present in Postman', () => {
    const spec = {
      info: { name: 'async-api', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'TestAsync',
          request: { method: 'GET', url: 'https://example.com/test' },
          response: [
            { code: 202, status: 'Accepted' }
          ]
        }
      ]
    };
    const result = generatePostmanWrekenfile(spec, {});
    const parsed = yamlLoad(result) as any;
    expect(Object.values<any>(parsed.METHODS)[0].EXECUTION.MODE).toBe('async');
  });
});
