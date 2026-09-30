import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile as v2OpenApi3 } from '../src/v2/openapi-to-wreken';
import { generateWrekenfile as v2Swagger2 } from '../src/v2/openapi-v2-to-wrekenfile';
import { generateWrekenfile as v1OpenApi3 } from '../src/v1/openapi-to-wreken';
import { generateWrekenfile as v1Swagger2 } from '../src/v1/openapi-v2-to-wrekenfile';

// Entries in an OpenAPI `security` list are alternatives: any one of them
// authenticates the request. Only the schemes inside one entry are combined.
// Emitting a header for every alternative sent extra auth headers with
// placeholder values, and CreateOS (whose spec offers X-Api-Key, X-Auth-Token
// or X-Access-Token) rejected valid API keys because of them.

const schemes = {
  apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
  authTokenAuth: { type: 'apiKey', in: 'header', name: 'X-Auth-Token' },
  accessTokenAuth: { type: 'apiKey', in: 'header', name: 'X-Access-Token' },
};

const alternatives = [{ apiKeyAuth: [] }, { authTokenAuth: [] }, { accessTokenAuth: [] }];

const paths = {
  '/v1/sandboxes': {
    get: { operationId: 'listSandboxes', responses: { '200': { description: 'ok' } } },
  },
  '/v1/combined': {
    // Both schemes in ONE entry: both are required together.
    get: {
      operationId: 'combined',
      security: [{ apiKeyAuth: [], authTokenAuth: [] }],
      responses: { '200': { description: 'ok' } },
    },
  },
  '/healthz': {
    // An explicitly public endpoint.
    get: { operationId: 'healthz', security: [], responses: { '200': { description: 'ok' } } },
  },
};

const openApi3 = {
  openapi: '3.0.3',
  info: { title: 'CreateOS-like', version: '1' },
  servers: [{ url: 'https://api.example.test' }],
  components: { securitySchemes: schemes },
  security: alternatives,
  paths,
};

const swagger2 = {
  swagger: '2.0',
  info: { title: 'CreateOS-like', version: '1' },
  host: 'api.example.test',
  basePath: '/',
  schemes: ['https'],
  securityDefinitions: schemes,
  security: alternatives,
  paths,
};

// headersOf returns the header names of the method whose endpoint is `endpoint`.
// v2 lists methods under METHODS with HTTP.ENDPOINT as a path and HEADERS as a
// map; v1 lists them under INTERFACES with a full ENDPOINT URL and HEADERS as a
// list of single-key maps.
function headersOf(yaml: string, endpoint: string): string[] {
  const doc = yamlLoad(yaml) as any;
  const method = Object.values<any>(doc.METHODS ?? doc.INTERFACES).find(
    (m) => m.HTTP?.ENDPOINT === endpoint || String(m.ENDPOINT ?? '').endsWith(endpoint),
  );
  expect(method, `no method for ${endpoint}`).toBeDefined();
  const headers = method.HTTP.HEADERS ?? {};
  return Array.isArray(headers) ? headers.flatMap((h: object) => Object.keys(h)) : Object.keys(headers);
}

const converters = [
  { name: 'v2 OpenAPI 3', spec: openApi3, generate: v2OpenApi3 },
  { name: 'v2 Swagger 2', spec: swagger2, generate: v2Swagger2 },
  { name: 'v1 OpenAPI 3', spec: openApi3, generate: v1OpenApi3 },
  { name: 'v1 Swagger 2', spec: swagger2, generate: v1Swagger2 },
];

describe.each(converters)('security alternatives ($name)', ({ spec, generate }) => {
  const yaml = generate(structuredClone(spec), __dirname) as string;

  it('uses only the first alternative as a header', () => {
    const headers = headersOf(yaml, '/v1/sandboxes');
    expect(headers).toContain('X-Api-Key');
    expect(headers).not.toContain('X-Auth-Token');
    expect(headers).not.toContain('X-Access-Token');
  });

  it('keeps every scheme required together in one entry', () => {
    const headers = headersOf(yaml, '/v1/combined');
    expect(headers).toContain('X-Api-Key');
    expect(headers).toContain('X-Auth-Token');
  });

  it('adds no auth header to an explicitly public endpoint', () => {
    const headers = headersOf(yaml, '/healthz');
    expect(headers).not.toContain('X-Api-Key');
    expect(headers).not.toContain('X-Auth-Token');
  });
});
