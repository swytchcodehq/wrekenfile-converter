import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile as v2OpenApi3 } from '../src/v2/openapi-to-wreken';
import { generateWrekenfile as v2Swagger2 } from '../src/v2/openapi-v2-to-wrekenfile';
import { generateWrekenfile as v2Postman, extractCollectionVariables } from '../src/v2/postman-to-wrekenfile';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const v3 = (spec: any) => yamlLoad(v2OpenApi3(spec, __dirname)) as any;
const v2 = (spec: any) => yamlLoad(v2Swagger2(spec, __dirname)) as any;
const postman = (collection: any) => yamlLoad(v2Postman(collection, extractCollectionVariables(collection))) as any;
const methods = (parsed: any) => Object.values<any>(parsed.METHODS);
const only = (parsed: any) => methods(parsed)[0];
const inputNames = (method: any) => (method.INPUTS || []).flatMap((i: any) => Object.keys(i));

const v3Spec = (extra: any) => ({
  openapi: '3.0.0',
  info: { title: 'probe', version: '1' },
  servers: [{ url: 'https://api.example.com' }],
  ...extra,
});
const ok = { '200': { description: 'ok' } };

// Auth header values are references to DEFAULTS keys, never literals.
function expectAuthHeadersReferenceDefaults(parsed: any) {
  for (const method of methods(parsed)) {
    for (const [name, value] of Object.entries<any>(method.HTTP?.HEADERS || {})) {
      if (name.toLowerCase() === 'content-type') continue;
      expect(parsed.DEFAULTS, `header ${name}: ${value}`).toHaveProperty([value]);
    }
  }
}

describe('auth scheme names are case-insensitive', () => {
  for (const scheme of ['Bearer', 'BEARER', 'bearer']) {
    it(`http scheme "${scheme}" becomes a bearer token`, () => {
      const parsed = v3Spec({
        components: { securitySchemes: { tok: { type: 'http', scheme } } },
        security: [{ tok: [] }],
        paths: { '/a': { get: { responses: ok } } },
      });
      const out = v3(parsed);
      expect(only(out).HTTP.HEADERS.Authorization).toBe('bearer_token');
      expect(out.DEFAULTS.bearer_token).toBe('Bearer <TOKEN>');
    });
  }

  it('http scheme "Basic" becomes basic auth', () => {
    const out = v3(v3Spec({
      components: { securitySchemes: { b: { type: 'http', scheme: 'Basic' } } },
      security: [{ b: [] }],
      paths: { '/a': { get: { responses: ok } } },
    }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('basic_auth');
    expect(out.DEFAULTS.basic_auth).toBe('Basic <BASE64>');
  });

  it('an unknown http scheme references a DEFAULTS key that exists', () => {
    const out = v3(v3Spec({
      components: { securitySchemes: { h: { type: 'http', scheme: 'HOBA' } } },
      security: [{ h: [] }],
      paths: { '/a': { get: { responses: ok } } },
    }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('hoba_auth');
    expect(out.DEFAULTS.hoba_auth).toBe('<HOBA_CREDENTIALS>');
  });

  it('templates use "Bearer", never "BEARER"', () => {
    const out = v3(v3Spec({
      components: { securitySchemes: { o: { type: 'oauth2', flows: {} } } },
      security: [{ o: [] }],
      paths: { '/a': { get: { responses: ok } } },
    }));
    expect(out.DEFAULTS.bearer_token).toBe('Bearer <ACCESS_TOKEN>');
  });
});

describe('API keys sent in the query', () => {
  const security = { components: { securitySchemes: { k: { type: 'apiKey', in: 'query', name: 'key' } } }, security: [{ k: [] }] };

  it('OpenAPI v3: adds an optional query input and keeps SECURITY', () => {
    const method = only(v3(v3Spec({ ...security, paths: { '/a': { get: { responses: ok } } } })));
    const input = method.INPUTS.find((i: any) => i.key).key;
    expect(input).toEqual({ TYPE: 'STRING', REQUIRED: false, LOCATION: 'query' });
    expect(method.SECURITY[0].k).toMatchObject({ type: 'apiKey', in: 'query', name: 'key' });
  });

  it('OpenAPI v3: does not duplicate a parameter the operation already declares', () => {
    const method = only(v3(v3Spec({
      ...security,
      paths: { '/a': { get: { parameters: [{ name: 'key', in: 'query', required: true, schema: { type: 'string' } }], responses: ok } } },
    })));
    expect(inputNames(method).filter((n: string) => n === 'key')).toHaveLength(1);
  });

  it('Swagger v2: adds an optional query input', () => {
    const method = only(v2({
      swagger: '2.0', info: { title: 'p', version: '1' }, host: 'api.example.com',
      securityDefinitions: { k: { type: 'apiKey', in: 'query', name: 'api_key' } }, security: [{ k: [] }],
      paths: { '/a': { get: { responses: ok } } },
    }));
    expect(inputNames(method)).toContain('api_key');
  });
});

describe('API keys sent in a cookie', () => {
  const security = { components: { securitySchemes: { c: { type: 'apiKey', in: 'cookie', name: 'session_key' } } }, security: [{ c: [] }] };

  it('OpenAPI v3: adds an optional cookie input, no header', () => {
    const out = v3(v3Spec({ ...security, paths: { '/a': { get: { responses: ok } } } }));
    expect(only(out).INPUTS).toContainEqual({ session_key: { TYPE: 'STRING', REQUIRED: false, LOCATION: 'cookie' } });
    expect(only(out).HTTP.HEADERS).toEqual({});
    expect(out.DEFAULTS.cookie_session_key).toBe('<SESSION_KEY>');
  });

  it('OpenAPI v3: does not duplicate a cookie parameter the operation already declares', () => {
    const method = only(v3(v3Spec({
      ...security,
      paths: { '/a': { get: { parameters: [{ name: 'session_key', in: 'cookie', required: true, schema: { type: 'string' } }], responses: ok } } },
    })));
    expect(inputNames(method).filter((n: string) => n === 'session_key')).toHaveLength(1);
  });

  it('Postman: an apikey Auth tab in a cookie becomes an optional cookie input', () => {
    const out = postman({
      info: { name: 'probe', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'a', request: {
        method: 'GET', header: [], url: { raw: 'https://api.example.com/a', host: ['api', 'example', 'com'], path: ['a'] },
        auth: { type: 'apikey', apikey: [{ key: 'key', value: 'sid' }, { key: 'in', value: 'cookie' }] },
      } }],
    });
    expect(only(out).INPUTS).toContainEqual({ sid: { TYPE: 'STRING', REQUIRED: false, LOCATION: 'cookie' } });
  });
});

describe('Authorization header parameter', () => {
  it('is matched in any casing', () => {
    const out = v3(v3Spec({
      paths: { '/a': { get: { parameters: [{ name: 'authorization', in: 'header', schema: { type: 'string' } }], responses: ok } } },
    }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('bearer_token');
    expect(out.DEFAULTS.bearer_token).toBe('Bearer <TOKEN>');
  });

  it('a Basic example is classified as basic auth', () => {
    const out = v3(v3Spec({
      paths: { '/a': { get: { parameters: [{ name: 'Authorization', in: 'header', example: 'Basic dXNlcjpwYXNz', schema: { type: 'string' } }], responses: ok } } },
    }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('basic_auth');
  });
});

describe('path- and operation-level parameters', () => {
  const pathParams = [
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ];

  it('OpenAPI v3: an operation parameter overrides the path one', () => {
    const method = only(v3(v3Spec({
      paths: { '/items/{id}': { parameters: pathParams, get: {
        parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer', maximum: 50 } }], responses: ok,
      } } },
    })));
    const limits = method.INPUTS.filter((i: any) => i.limit);
    expect(limits).toHaveLength(1);
    expect(limits[0].limit).toMatchObject({ REQUIRED: true, MAXIMUM: 50 });
    expect(inputNames(method)).toEqual(['id', 'limit']);
  });

  it('OpenAPI v3: same name in a different location is kept', () => {
    const method = only(v3(v3Spec({
      paths: { '/a': { parameters: [{ name: 'v', in: 'query', schema: { type: 'string' } }], get: {
        parameters: [{ name: 'v', in: 'header', schema: { type: 'string' } }], responses: ok,
      } } },
    })));
    expect(inputNames(method)).toEqual(['v', 'v']);
  });

  it('Swagger v2: an operation parameter overrides the path one', () => {
    const method = only(v2({
      swagger: '2.0', info: { title: 'p', version: '1' }, host: 'api.example.com',
      paths: { '/a': { parameters: [{ name: 'limit', in: 'query', type: 'integer' }], get: {
        parameters: [{ name: 'limit', in: 'query', type: 'integer', required: true }], responses: ok,
      } } },
    }));
    const limits = method.INPUTS.filter((i: any) => i.limit);
    expect(limits).toHaveLength(1);
    expect(limits[0].limit.REQUIRED).toBe(true);
  });
});

describe('JSON media type variants', () => {
  const objectSchema = { type: 'object', properties: { name: { type: 'string' } } };

  for (const mediaType of ['application/json; charset=utf-8', 'application/vnd.api+json']) {
    it(`a ${mediaType} response gets a struct return type`, () => {
      const out = v3(v3Spec({
        paths: { '/a': { get: { operationId: 'getA', responses: { '200': { description: 'ok', content: { [mediaType]: { schema: objectSchema } } } } } } },
      }));
      const ret = only(out).RETURNS[0].RETURNTYPE;
      expect(ret).toMatch(/^STRUCT\(/);
      expect(out.STRUCTS).toHaveProperty([ret.slice('STRUCT('.length, -1)]);
    });
  }

  it('an application/problem+json error gets a struct type', () => {
    const out = v3(v3Spec({
      paths: { '/a': { get: { operationId: 'getA', responses: { ...ok, '400': { description: 'bad', content: { 'application/problem+json': { schema: { type: 'object', properties: { detail: { type: 'string' } } } } } } } } } },
    }));
    const err = only(out).ERRORS[0].TYPE;
    expect(err).toMatch(/^STRUCT\(/);
    expect(out.STRUCTS).toHaveProperty([err.slice('STRUCT('.length, -1)]);
  });

  it('a request body declared as JSON with a charset is a JSON body', () => {
    const method = only(v3(v3Spec({
      paths: { '/a': { post: { operationId: 'postA', requestBody: { content: { 'application/json; charset=utf-8': { schema: objectSchema } } }, responses: ok } } },
    })));
    expect(method.HTTP.BODY.TYPE).toMatch(/^STRUCT\(/);
    expect(method.HTTP.BODYTYPE).toBeUndefined();
  });

  it('multipart with a boundary parameter is still form-data', () => {
    const method = only(v3(v3Spec({
      paths: { '/a': { post: { requestBody: { content: { 'multipart/form-data; boundary=x': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: ok } } },
    })));
    expect(method.HTTP.BODYTYPE).toBe('form-data');
  });
});

describe('pagination hints', () => {
  const page = (properties: any) => only(v3(v3Spec({
    paths: { '/a': { get: { operationId: 'list', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties } } } } } } } },
  }))).RETURNS[0].PAGINATION;

  it('PAGE_SIZE_FIELD is the page size property name', () => {
    expect(page({ page: { type: 'integer' }, pageSize: { type: 'integer' } })).toEqual({ TYPE: 'page', PAGE_SIZE_FIELD: 'pageSize' });
    expect(page({ page: { type: 'integer' }, per_page: { type: 'integer' } })).toEqual({ TYPE: 'page', PAGE_SIZE_FIELD: 'per_page' });
    expect(page({ page: { type: 'integer' } })).toEqual({ TYPE: 'page', PAGE_SIZE_FIELD: 'limit' });
  });

  it('Swagger v2 uses the same names', () => {
    const method = only(v2({
      swagger: '2.0', info: { title: 'p', version: '1' }, host: 'api.example.com',
      paths: { '/a': { get: { operationId: 'list', responses: { '200': { description: 'ok', schema: { type: 'object', properties: { page: { type: 'integer' }, pageSize: { type: 'integer' } } } } } } } },
    }));
    expect(method.RETURNS[0].PAGINATION.PAGE_SIZE_FIELD).toBe('pageSize');
  });
});

describe('OpenAPI 3.1 webhooks', () => {
  const webhooks = { newItem: { post: { operationId: 'newItemHook', responses: ok } } };

  it('are not methods when the spec has paths', () => {
    const out = v3({ ...v3Spec({ paths: { '/a': { get: { responses: ok } } }, webhooks }), openapi: '3.1.0' });
    expect(methods(out)).toHaveLength(1);
    expect(only(out).HTTP.ENDPOINT).toBe('/a');
  });

  it('a webhook-only spec is converted with each name as a path', () => {
    const out = v3({ ...v3Spec({ webhooks }), openapi: '3.1.0' });
    expect(methods(out)).toHaveLength(1);
    expect(only(out).HTTP.ENDPOINT).toBe('/newItem');
  });
});

describe('server URL variables', () => {
  const base = (servers: any) => v3(v3Spec({ servers, paths: { '/a': { get: { responses: ok } } } })).DEFAULTS.w_base_url;

  it('are filled from their defaults', () => {
    expect(base([{ url: 'https://{region}.api.example.com/{v}/', variables: { region: { default: 'us' }, v: { enum: ['v2', 'v1'] } } }]))
      .toBe('https://us.api.example.com/v2');
  });

  it('without a default are left as placeholders', () => {
    expect(base([{ url: 'https://{tenant}.example.com' }])).toBe('https://{tenant}.example.com');
  });
});

describe('Postman auth', () => {
  const request = (extra: any = {}) => ({
    method: 'GET', header: [], url: { raw: 'https://api.example.com/a', host: ['api', 'example', 'com'], path: ['a'] }, ...extra,
  });
  const collection = (extra: any) => ({
    info: { name: 'probe', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    ...extra,
  });
  const byEndpoint = (out: any) => Object.fromEntries(methods(out).map((m: any) => [m.HTTP.ENDPOINT, m]));

  it('inherits the collection Auth tab, honours folder noauth and request overrides', () => {
    const out = postman(collection({
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
      item: [
        { name: 'inherits', request: request({ url: { raw: 'https://api.example.com/one', host: ['api', 'example', 'com'], path: ['one'] } }) },
        { name: 'public', auth: { type: 'noauth' }, item: [
          { name: 'open', request: request({ url: { raw: 'https://api.example.com/two', host: ['api', 'example', 'com'], path: ['two'] } }) },
        ] },
        { name: 'basic', request: request({
          auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }] },
          url: { raw: 'https://api.example.com/three', host: ['api', 'example', 'com'], path: ['three'] },
        }) },
      ],
    }));
    const m = byEndpoint(out);
    expect(m['/one'].HTTP.HEADERS.Authorization).toBe('bearer_token');
    expect(m['/two'].HTTP.HEADERS.Authorization).toBeUndefined();
    expect(m['/three'].HTTP.HEADERS.Authorization).toBe('basic_auth');
    expect(out.DEFAULTS.bearer_token).toBe('Bearer <TOKEN>');
    expect(out.DEFAULTS.basic_auth).toBe('Basic <BASE64>');
  });

  it('an explicit Basic Authorization header is basic auth, not a bearer token', () => {
    const out = postman(collection({ item: [{ name: 'a', request: request({ header: [{ key: 'Authorization', value: 'Basic {{creds}}' }] }) }] }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('basic_auth');
  });

  it('an apikey Auth tab in the query becomes an optional query input', () => {
    const out = postman(collection({ item: [{ name: 'a', request: request({
      auth: { type: 'apikey', apikey: [{ key: 'key', value: 'api_key' }, { key: 'value', value: '{{k}}' }, { key: 'in', value: 'query' }] },
    }) }] }));
    expect(only(out).INPUTS).toContainEqual({ api_key: { TYPE: 'STRING', REQUIRED: false, LOCATION: 'query' } });
    expect(only(out).HTTP.HEADERS).toEqual({});
  });

  it('an apikey Auth tab in a header (v2.0 object form) becomes that header', () => {
    const out = postman(collection({ item: [{ name: 'a', request: request({
      auth: { type: 'apikey', apikey: { key: 'X-Token', value: '{{k}}' } },
    }) }] }));
    expect(only(out).HTTP.HEADERS['X-Token']).toBe('x-token');
    expect(out.DEFAULTS['x-token']).toBe('<X-TOKEN>');
  });

  it('an Authorization header with no value is ignored', () => {
    for (const header of [{ key: 'Authorization', value: '' }, { key: 'Authorization', value: '  ' }, { key: 'Authorization' }]) {
      const out = postman(collection({ item: [{ name: 'a', request: request({ auth: { type: 'noauth' }, header: [header] }) }] }));
      expect(only(out).HTTP.HEADERS.Authorization).toBeUndefined();
      expect(out.DEFAULTS.bearer_token).toBeUndefined();
    }
  });

  it('an empty Authorization header does not replace the Auth tab', () => {
    const out = postman(collection({ item: [{ name: 'a', request: request({
      auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }] },
      header: [{ key: 'Authorization', value: '' }],
    }) }] }));
    expect(only(out).HTTP.HEADERS.Authorization).toBe('basic_auth');
  });

  it('a disabled Authorization header is ignored', () => {
    const out = postman(collection({ item: [{ name: 'a', request: request({ header: [{ key: 'Authorization', value: 'Bearer x', disabled: true }] }) }] }));
    expect(only(out).HTTP.HEADERS.Authorization).toBeUndefined();
  });
});

describe('every auth header references a DEFAULTS key', () => {
  const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));

  it('OpenAPI v3 fixtures', () => {
    expectAuthHeadersReferenceDefaults(yamlLoad(v2OpenApi3(fixture('petstore-v3.json'), FIXTURES_DIR)));
    expectAuthHeadersReferenceDefaults(yamlLoad(v2OpenApi3(fixture('petstore-v3-extended.json'), FIXTURES_DIR)));
  });

  it('Swagger v2 fixture', () => {
    expectAuthHeadersReferenceDefaults(yamlLoad(v2Swagger2(fixture('petstore-v2.json'), FIXTURES_DIR)));
  });

  it('Postman fixture', () => {
    expectAuthHeadersReferenceDefaults(postman(fixture('postman-collection.json')));
  });
});
