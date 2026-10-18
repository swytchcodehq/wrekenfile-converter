import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import * as os from 'os';
import { generateWrekenfile as v2OpenApi3 } from '../src/v2/openapi-to-wreken';
import { generateWrekenfile as v2Swagger2 } from '../src/v2/openapi-v2-to-wrekenfile';
import { generateWrekenfile as v2Postman, extractCollectionVariables } from '../src/v2/postman-to-wrekenfile';
import { generateMiniWrekenfiles } from '../src/v2/mini-wrekenfile-generator';
import { computeConversionStats } from '../src/v2/utils/conversion-stats';
import { validateWrekenfile } from '../src/v1/wrekenfile-validator';

// Wrekenfile 2.1.0: APIs that sign every request (crypto exchanges) declare an
// x-swytchcode-signing recipe. The converter copies it into SIGNING, marks the
// methods it signs with SECURITY: request_signature, and never emits the
// headers or parameters the signer produces - a placeholder sent as-is (e.g.
// "X-AUTH-SIGNATURE: x-auth-signature") is always rejected, and an agent must
// never be asked for a timestamp or signature.

const FIXTURES = path.join(__dirname, 'fixtures');

function convertFixture(file: string): any {
  const spec = yamlLoad(fs.readFileSync(path.join(FIXTURES, file), 'utf-8'));
  return yamlLoad(v2OpenApi3(spec, FIXTURES));
}

function isSigned(method: any): boolean {
  return JSON.stringify(method.SECURITY || []).includes('"request_signature"');
}

function allInputNames(method: any): string[] {
  return (method.INPUTS || []).flatMap((e: any) => Object.keys(e));
}

describe('request signing: CoinSwitch', () => {
  const wf = convertFixture('coinswitch-v2.yaml');
  const methods = Object.entries<any>(wf.METHODS);

  it('emits Wrekenfile 2.1.0 with the SIGNING recipe copied verbatim', () => {
    expect(wf.VERSION).toBe('2.1.0');
    const recipe = wf.SIGNING.CoinSwitchSignature;
    expect(recipe.version).toBe(1);
    expect(recipe.set.headers['X-AUTH-SIGNATURE']).toBe('{sig}');
    expect(recipe.time_sync.proactive).toBe(true);
  });

  it('signs every authenticated method and none of the public ones', () => {
    const unsigned = methods.filter(([, m]) => !isSigned(m)).map(([id]) => id).sort();
    expect(unsigned).toEqual(['coinswitch.futures.ticker.list', 'coinswitch.ping.check', 'coinswitch.spot.ticker.list', 'coinswitch.time.get']);
    for (const id of unsigned) expect(wf.METHODS[id].SECURITY).toEqual([]);
    expect(wf.METHODS['coinswitch.spot.order.create'].SECURITY).toEqual([{ CoinSwitchSignature: { type: 'request_signature' } }]);
  });

  it('never emits signer headers, inputs or DEFAULTS placeholders', () => {
    for (const [, m] of methods) {
      expect(Object.keys(m.HTTP.HEADERS || {}).map((h) => h.toLowerCase())).not.toContain('x-auth-signature');
      expect(Object.keys(m.HTTP.HEADERS || {}).map((h) => h.toLowerCase())).not.toContain('x-auth-apikey');
      expect(allInputNames(m).map((n) => n.toLowerCase())).not.toContain('x-auth-epoch');
    }
    expect(Object.keys(wf.DEFAULTS)).toEqual(['w_base_url']);
  });

  it('names methods from x-swytchcode-canonical-id', () => {
    expect(wf.METHODS['coinswitch.spot.order.create'].HTTP.ENDPOINT).toBe('/trade/api/v2/order');
    expect(wf.METHODS['coinswitch.futures.order.create'].HTTP.ENDPOINT).toBe('/trade/api/v2/futures/order');
    expect(Object.keys(wf.METHODS).some((id) => /\d$/.test(id))).toBe(false);
  });

  it('keeps the HFT recipe rules (main and B2B master key pairs)', () => {
    const hft = convertFixture('coinswitch-hft-v5.yaml');
    expect(hft.SIGNING.CoinSwitchSignature.rules.map((r: any) => r.path_prefix)).toEqual(['/dma/api/v1/master/', '/']);
    expect(Object.values<any>(hft.METHODS).every(isSigned)).toBe(true);
  });
});

// Binance-style: the signer injects timestamp and recvWindow and appends the
// signature to the query; the spec lists all three as (required) parameters.
const binanceRecipe = {
  version: 1,
  credentials: [{ name: 'api_key' }, { name: 'secret_key', secret: true }],
  steps: [
    { id: 'ts', op: 'time', unit: 'ms' },
    { id: 'msg', op: 'concat', parts: ['{query}', '{body}'] },
    { id: 'sig', op: 'hmac', alg: 'sha256', key: 'secret_key', input: '{msg}', output: 'hex' },
  ],
  inject: { query: [{ name: 'recvWindow', value: '5000' }, { name: 'timestamp', value: '{ts}' }] },
  set: { headers: { 'X-MBX-APIKEY': '{api_key}' }, query: [{ name: 'signature', value: '{sig}' }] },
};

function binanceLikeSpec(recipeAt: 'scheme' | 'root' | 'none'): any {
  const scheme: any = { type: 'apiKey', in: 'header', name: 'X-MBX-APIKEY' };
  if (recipeAt === 'scheme') scheme['x-swytchcode-signing'] = binanceRecipe;
  const spec: any = {
    openapi: '3.0.3',
    info: { title: 'Binance', version: '1', 'x-swytchcode-namespace': 'binance' },
    servers: [{ url: 'https://api.binance.com' }],
    paths: {
      '/api/v3/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } },
      '/api/v3/account': {
        get: {
          operationId: 'account',
          parameters: [
            { $ref: '#/components/parameters/recvWindow' },
            { $ref: '#/components/parameters/timestamp' },
            { $ref: '#/components/parameters/signature' },
            { name: 'omitZeroBalances', in: 'query', schema: { type: 'boolean' } },
          ],
          security: [{ ApiKeyAuth: [] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: { ApiKeyAuth: scheme },
      parameters: {
        recvWindow: { name: 'recvWindow', in: 'query', schema: { type: 'integer' } },
        timestamp: { name: 'timestamp', in: 'query', required: true, schema: { type: 'integer' } },
        signature: { name: 'signature', in: 'query', required: true, schema: { type: 'string' } },
      },
    },
  };
  if (recipeAt === 'root') spec['x-swytchcode-signing'] = binanceRecipe;
  return spec;
}

describe('request signing: signer-owned parameters (Binance-style)', () => {
  for (const at of ['scheme', 'root'] as const) {
    it(`drops timestamp, recvWindow, signature and the key header (recipe at ${at})`, () => {
      const wf: any = yamlLoad(v2OpenApi3(binanceLikeSpec(at), FIXTURES));
      const account = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/api/v3/account');
      expect(isSigned(account)).toBe(true);
      expect(allInputNames(account)).toEqual(['omitZeroBalances']);
      expect(account.HTTP.HEADERS).toEqual({});
      expect(wf.DEFAULTS).toEqual({ w_base_url: 'https://api.binance.com' });
      const recipeName = at === 'scheme' ? 'ApiKeyAuth' : 'request_signature';
      expect(Object.keys(wf.SIGNING)).toEqual([recipeName]);
      const ping = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/api/v3/ping');
      expect(isSigned(ping)).toBe(false);
    });
  }

  it('without a recipe, keeps today\'s output and warns that methods look signed', () => {
    const yaml = v2OpenApi3(binanceLikeSpec('none'), FIXTURES);
    const wf: any = yamlLoad(yaml);
    expect(wf.SIGNING).toBeUndefined();
    const account = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/api/v3/account');
    expect(allInputNames(account)).toContain('signature');
    expect(computeConversionStats(wf).warnings.join('\n')).toMatch(/look signed/);
  });

  it('counts signed methods as authenticated in the stats', () => {
    const stats = computeConversionStats(yamlLoad(v2OpenApi3(binanceLikeSpec('scheme'), FIXTURES)));
    expect(stats.methodsSigned).toBe(1);
    expect(stats.methodsWithAuth).toBe(1);
    expect(stats.warnings.join('\n')).not.toMatch(/look signed/);
  });
});

describe('request signing: unsigned operations keep their API-key scheme', () => {
  // Binance's user-data-stream endpoints take only the API key header; the same
  // header is one the signer sets on signed endpoints.
  const recipe = { ...binanceRecipe, set: { headers: { 'X-MBX-APIKEY': '{api_key}' }, query: [{ name: 'signature', value: '{sig}' }] } };
  function spec(): any {
    return {
      openapi: '3.0.3',
      info: { title: 'Binance', version: '1', 'x-swytchcode-namespace': 'binance' },
      servers: [{ url: 'https://api.binance.com' }],
      paths: {
        '/api/v3/account': { get: { operationId: 'account', security: [{ Signed: [] }], responses: { '200': { description: 'ok' } } } },
        '/api/v3/userDataStream': { post: { operationId: 'stream', security: [{ KeyOnly: [] }], responses: { '200': { description: 'ok' } } } },
      },
      components: {
        securitySchemes: {
          Signed: { type: 'apiKey', in: 'query', name: 'signature', 'x-swytchcode-signing': recipe },
          KeyOnly: { type: 'apiKey', in: 'header', name: 'X-MBX-APIKEY' },
        },
      },
    };
  }

  function check(wf: any) {
    const byPath = (p: string) => Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === p);
    expect(isSigned(byPath('/api/v3/account'))).toBe(true);
    expect(Object.keys(byPath('/api/v3/account').HTTP.HEADERS || {})).not.toContain('X-MBX-APIKEY');
    const stream = byPath('/api/v3/userDataStream');
    expect(isSigned(stream)).toBe(false);
    expect(Object.keys(stream.HTTP.HEADERS || {})).toContain('X-MBX-APIKEY');
    expect(Object.keys(wf.DEFAULTS).length).toBeGreaterThan(1);
  }

  it('OpenAPI 3', () => {
    check(yamlLoad(v2OpenApi3(spec(), FIXTURES)));
  });

  it('Swagger 2', () => {
    const s = spec();
    const swagger: any = {
      swagger: '2.0',
      info: s.info,
      host: 'api.binance.com',
      schemes: ['https'],
      paths: s.paths,
      securityDefinitions: s.components.securitySchemes,
    };
    check(yamlLoad(v2Swagger2(swagger, FIXTURES)));
  });
});

describe('request signing: a method loses only its own recipe\'s names', () => {
  // Two recipes: Spot injects a query `timestamp`; Futures injects a body `nonce`.
  const spotRecipe = { ...binanceRecipe };
  const futuresRecipe = {
    version: 1,
    credentials: [{ name: 'api_key' }, { name: 'secret_key', secret: true }],
    steps: [
      { id: 'n', op: 'nonce', kind: 'monotonic_ms' },
      { id: 'sig', op: 'hmac', alg: 'sha256', key: 'secret_key', input: '{body}', output: 'hex' },
    ],
    inject: { body_fields: [{ name: 'nonce', value: '{n}' }] },
    set: { headers: { 'X-FUT-SIGN': '{sig}' } },
  };
  function spec(): any {
    const body = (props: Record<string, any>) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties: props } } } });
    return {
      openapi: '3.0.3',
      info: { title: 'Ex', version: '1', 'x-swytchcode-namespace': 'ex' },
      servers: [{ url: 'https://api.ex.com' }],
      paths: {
        '/spot/order': {
          post: {
            operationId: 'spotOrder',
            security: [{ Spot: [] }],
            parameters: [{ name: 'timestamp', in: 'query', schema: { type: 'integer' } }],
            requestBody: body({ symbol: { type: 'string' }, nonce: { type: 'string' } }),
            responses: { '200': { description: 'ok' } },
          },
        },
        '/futures/order': {
          post: {
            operationId: 'futuresOrder',
            security: [{ Futures: [] }],
            parameters: [{ name: 'timestamp', in: 'query', schema: { type: 'integer' } }],
            requestBody: body({ symbol: { type: 'string' }, nonce: { type: 'string' } }),
            responses: { '200': { description: 'ok' } },
          },
        },
        '/spot/candles/{timestamp}': {
          get: {
            operationId: 'candlesAt',
            security: [{ Spot: [] }],
            parameters: [{ name: 'timestamp', in: 'path', required: true, schema: { type: 'integer' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        securitySchemes: {
          Spot: { type: 'apiKey', in: 'header', name: 'X-MBX-APIKEY', 'x-swytchcode-signing': spotRecipe },
          Futures: { type: 'apiKey', in: 'header', name: 'X-FUT-SIGN', 'x-swytchcode-signing': futuresRecipe },
        },
      },
    };
  }
  const wf: any = yamlLoad(v2OpenApi3(spec(), FIXTURES));
  const byPath = (p: string) => Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === p);
  const bodyFields = (m: any) => (wf.STRUCTS[m.HTTP.BODY.TYPE.match(/^STRUCT\((.+)\)$/)[1]] || []).map((f: any) => f.name);

  it('keeps names the other recipe produces', () => {
    const spot = byPath('/spot/order');
    expect(allInputNames(spot)).not.toContain('timestamp');
    expect(bodyFields(spot)).toContain('nonce');
    const futures = byPath('/futures/order');
    expect(allInputNames(futures)).toContain('timestamp');
    expect(bodyFields(futures)).not.toContain('nonce');
  });

  it('keeps a path input that shares a name with an injected query parameter', () => {
    const candles = byPath('/spot/candles/{timestamp}');
    expect(isSigned(candles)).toBe(true);
    expect(allInputNames(candles)).toContain('timestamp');
  });

  it('validates: a path timestamp is the caller\'s, a query timestamp is not', () => {
    const tmp = path.join(os.tmpdir(), `wreken-scope-${process.pid}.yaml`);
    fs.writeFileSync(tmp, yamlDump(wf));
    expect(validateWrekenfile(tmp).errors).toEqual([]);
    byPath('/futures/order').SECURITY = [{ Spot: { type: 'request_signature' } }];
    fs.writeFileSync(tmp, yamlDump(wf));
    expect(validateWrekenfile(tmp).errors.join('\n')).toMatch(/input 'timestamp' is set by signing recipe 'Spot'/);
  });
});

describe('request signing: look-signed warning', () => {
  it('does not fire for an ordinary timestamp query filter', () => {
    const wf = {
      METHODS: {
        'x.trades.list': { HTTP: { METHOD: 'GET', ENDPOINT: '/trades', HEADERS: {} }, INPUTS: [{ timestamp: { TYPE: 'INT', LOCATION: 'query' } }] },
      },
    };
    expect(computeConversionStats(wf).warnings.join('\n')).not.toMatch(/look signed/);
  });

  it('fires for a timestamp header', () => {
    const wf = {
      METHODS: {
        'x.orders.list': { HTTP: { METHOD: 'GET', ENDPOINT: '/orders', HEADERS: {} }, INPUTS: [{ 'X-BX-TIMESTAMP': { TYPE: 'STRING', LOCATION: 'header' } }] },
      },
    };
    expect(computeConversionStats(wf).warnings.join('\n')).toMatch(/look signed/);
  });
});

describe('request signing: signer-owned body fields', () => {
  it('drops an injected body field from the request STRUCT', () => {
    const spec: any = {
      openapi: '3.0.3',
      info: { title: 'CoinDCX', version: '1', 'x-swytchcode-namespace': 'coindcx' },
      servers: [{ url: 'https://api.coindcx.com' }],
      'x-swytchcode-signing': {
        version: 1,
        credentials: [{ name: 'api_key' }, { name: 'secret_key', secret: true }],
        steps: [{ id: 'ts', op: 'time', unit: 'ms' }, { id: 'sig', op: 'hmac', alg: 'sha256', key: 'secret_key', input: '{body}' }],
        inject: { body_fields: [{ name: 'timestamp', value: '{ts}', type: 'number' }] },
        set: { headers: { 'X-AUTH-APIKEY': '{api_key}', 'X-AUTH-SIGNATURE': '{sig}' } },
      },
      security: [{ key: [] }],
      paths: {
        '/exchange/v1/orders/create': {
          post: {
            operationId: 'createOrder',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['side', 'timestamp'],
                    properties: { side: { type: 'string' }, timestamp: { type: 'integer' } },
                  },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-AUTH-APIKEY' } } },
    };
    const wf: any = yamlLoad(v2OpenApi3(spec, FIXTURES));
    const m = Object.values<any>(wf.METHODS)[0];
    const struct = wf.STRUCTS[String(m.HTTP.BODY.TYPE).replace(/^STRUCT\((.+)\)$/, '$1')];
    expect(struct.map((f: any) => f.name)).toEqual(['side']);
  });
});

describe('request signing: Swagger 2', () => {
  it('reads the recipe from securityDefinitions', () => {
    const spec: any = {
      swagger: '2.0',
      info: { title: 'Ex', version: '1', 'x-swytchcode-namespace': 'ex' },
      host: 'api.example.com',
      schemes: ['https'],
      securityDefinitions: {
        sig: { type: 'apiKey', in: 'header', name: 'X-SIGN', 'x-swytchcode-signing': {
          version: 1,
          credentials: [{ name: 'secret_key', secret: true }],
          steps: [{ id: 'sig', op: 'hmac', alg: 'sha256', key: 'secret_key', input: '{path}' }],
          set: { headers: { 'X-SIGN': '{sig}' } },
        } },
      },
      paths: {
        '/v1/balance': { get: { operationId: 'balance', security: [{ sig: [] }], responses: { '200': { description: 'ok' } } } },
        '/v1/time': { get: { operationId: 'time', responses: { '200': { description: 'ok' } } } },
      },
    };
    const wf: any = yamlLoad(v2Swagger2(spec, FIXTURES));
    const balance = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/v1/balance');
    expect(balance.SECURITY).toEqual([{ sig: { type: 'request_signature' } }]);
    expect(balance.HTTP.HEADERS).toEqual({});
    expect(wf.SIGNING.sig.version).toBe(1);
    expect(Object.keys(wf.DEFAULTS)).toEqual(['w_base_url']);
  });
});

describe('request signing: Postman', () => {
  const collection = {
    info: { name: 'Binance', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'url', value: 'https://api.binance.com' }, { key: 'timestamp', value: '' }, { key: 'signature', value: '' }],
    item: [
      {
        name: 'Account',
        request: {
          method: 'GET',
          header: [{ key: 'X-MBX-APIKEY', value: '{{binance-api-key}}' }],
          url: {
            raw: '{{url}}/api/v3/account?timestamp={{timestamp}}&signature={{signature}}',
            host: ['{{url}}'],
            path: ['api', 'v3', 'account'],
            query: [{ key: 'timestamp', value: '{{timestamp}}' }, { key: 'signature', value: '{{signature}}' }, { key: 'omitZeroBalances', value: 'true' }],
          },
        },
      },
      {
        name: 'Ping',
        request: { method: 'GET', header: [], url: { raw: '{{url}}/api/v3/ping', host: ['{{url}}'], path: ['api', 'v3', 'ping'] } },
      },
    ],
  };

  it('with a recipe attached, signs requests whose script fills the signature', () => {
    const wf: any = yamlLoad(v2Postman(collection, extractCollectionVariables(collection), { signing: binanceRecipe }));
    const account = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/api/v3/account');
    const ping = Object.values<any>(wf.METHODS).find((m) => m.HTTP.ENDPOINT === '/api/v3/ping');
    expect(isSigned(account)).toBe(true);
    expect(isSigned(ping)).toBe(false);
    expect(allInputNames(account)).toContain('omitZeroBalances');
    for (const owned of ['timestamp', 'signature', 'recvWindow', 'X-MBX-APIKEY']) {
      expect(allInputNames(account)).not.toContain(owned);
    }
    expect(Object.keys(account.HTTP.HEADERS)).not.toContain('X-MBX-APIKEY');
    expect(Object.keys(wf.DEFAULTS)).not.toContain('signature');
    expect(Object.keys(wf.DEFAULTS)).not.toContain('timestamp');
    expect(wf.SIGNING.request_signature.version).toBe(1);
  });

  it('reads a recipe stored as a collection variable', () => {
    const withVar = { ...collection, variable: [...collection.variable, { key: 'x-swytchcode-signing', value: JSON.stringify(binanceRecipe) }] };
    const wf: any = yamlLoad(v2Postman(withVar, extractCollectionVariables(withVar)));
    expect(Object.keys(wf.SIGNING)).toEqual(['request_signature']);
    expect(Object.keys(wf.DEFAULTS)).not.toContain('x-swytchcode-signing');
  });

  it('without a recipe, warns instead of silently emitting placeholders', () => {
    const wf: any = yamlLoad(v2Postman(collection, extractCollectionVariables(collection)));
    expect(wf.SIGNING).toBeUndefined();
    expect(computeConversionStats(wf).warnings.join('\n')).toMatch(/look signed/);
  });
});

describe('request signing: mini-Wrekenfiles', () => {
  it('marks signed methods SIGNED and leaves public ones alone', () => {
    const spec = yamlLoad(fs.readFileSync(path.join(FIXTURES, 'coinswitch-v2.yaml'), 'utf-8'));
    const minis = generateMiniWrekenfiles(v2OpenApi3(spec, FIXTURES));
    const byId = Object.fromEntries(minis.map((m) => [m.metadata.canonicalId, yamlLoad(m.content) as any]));
    expect(byId['coinswitch.spot.order.create'].HTTP.SIGNED).toBe(true);
    expect(byId['coinswitch.time.get'].HTTP.SIGNED).toBeUndefined();
    expect(byId['coinswitch.time.get'].VERSION).toBe('2.1.0');
  });
});

describe('request signing: validator', () => {
  const tmp = path.join(os.tmpdir(), `wreken-signing-${process.pid}`);
  fs.mkdirSync(tmp, { recursive: true });

  function validate(doc: any) {
    const file = path.join(tmp, `w${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(file, yamlDump(doc));
    return validateWrekenfile(file);
  }

  it('accepts the converted CoinSwitch Wrekenfile', () => {
    const r = validate(convertFixture('coinswitch-v2.yaml'));
    expect(r.errors).toEqual([]);
    expect(r.isValid).toBe(true);
  });

  it('rejects a request_signature SECURITY with no matching recipe', () => {
    const wf = convertFixture('coinswitch-v2.yaml');
    delete wf.SIGNING;
    const r = validate(wf);
    expect(r.isValid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/not in SIGNING/);
  });

  it('rejects signer-owned headers and inputs on a signed method', () => {
    const wf = convertFixture('coinswitch-v2.yaml');
    const m = wf.METHODS['coinswitch.spot.order.create'];
    m.HTTP.HEADERS['X-AUTH-SIGNATURE'] = 'x-auth-signature';
    m.INPUTS.push({ 'X-AUTH-EPOCH': { TYPE: 'STRING', LOCATION: 'header' } });
    const errors = validate(wf).errors.join('\n');
    expect(errors).toMatch(/header 'X-AUTH-SIGNATURE' is set by signing recipe/);
    expect(errors).toMatch(/input 'X-AUTH-EPOCH' is set by signing recipe/);
  });

  it('rejects a signer-owned input with a lowercase or missing location', () => {
    const wf = convertFixture('coinswitch-v2.yaml');
    const m = wf.METHODS['coinswitch.spot.order.create'];
    m.INPUTS.push({ 'X-AUTH-EPOCH': { TYPE: 'STRING', location: 'header' } });
    m.INPUTS.push({ 'X-AUTH-APIKEY': 'STRING' });
    const errors = validate(wf).errors.join('\n');
    expect(errors).toMatch(/input 'X-AUTH-EPOCH' is set by signing recipe/);
    expect(errors).toMatch(/input 'X-AUTH-APIKEY' is set by signing recipe/);
  });

  it('rejects an unknown op and a recipe that places nothing', () => {
    const wf = convertFixture('coinswitch-v2.yaml');
    wf.SIGNING.CoinSwitchSignature.steps[0].op = 'eval';
    wf.SIGNING.Other = { version: 1, credentials: [{ name: 'k' }], steps: [], set: {} };
    const errors = validate(wf).errors.join('\n');
    expect(errors).toMatch(/unknown op 'eval'/);
    expect(errors).toMatch(/SIGNING.Other: set places nothing/);
  });
});
