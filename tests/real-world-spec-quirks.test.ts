import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile as generateV2Wrekenfile } from '../src/v2/openapi-v2-to-wrekenfile';
import { generateWrekenfile as generateV3Wrekenfile } from '../src/v2/openapi-to-wreken';

/**
 * Regressions surfaced by converting a large, real-world Swagger 2.0 spec
 * (Oracle Eloqua) where only ~half of the operations and ~a third of the
 * struct definitions survived conversion. Three independent bugs compounded:
 *
 * 1. Methods were keyed by operationId, so specs that reuse operationId
 *    across endpoints (common despite the OpenAPI spec requiring uniqueness)
 *    silently dropped every collision but the last.
 * 2. Inline response schemas with `properties` but no explicit
 *    `"type": "object"` fell through to a bogus `'OBJECT'` literal instead
 *    of a `STRUCT(...)` reference, so the matching struct (and anything it
 *    referenced) got filtered out as unused.
 * 3. Inline struct names were derived from a lossy canonical-id transform
 *    with no collision handling, so unrelated endpoints could generate the
 *    same struct name and silently clobber each other's fields.
 */

describe('duplicate operationId across endpoints', () => {
  const makeSpec = () => ({
    swagger: '2.0',
    info: { title: 'dup-op-ids', version: '1.0' },
    host: 'example.com',
    basePath: '/',
    paths: {
      '/accounts': {
        get: {
          operationId: 'SearchGETRest20',
          responses: { '200': { description: 'ok' } },
        },
      },
      '/contacts': {
        get: {
          operationId: 'SearchGETRest20',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });

  it('keeps both endpoints in Swagger v2 conversion', () => {
    const result = generateV2Wrekenfile(makeSpec(), __dirname);
    const parsed = yamlLoad(result) as any;
    const endpoints = Object.values<any>(parsed.METHODS).map((m) => m.HTTP.ENDPOINT).sort();
    expect(endpoints).toEqual(['/accounts', '/contacts']);
  });

  it('keeps both endpoints in OpenAPI v3 conversion', () => {
    const v3Spec = {
      openapi: '3.0.0',
      info: { title: 'dup-op-ids', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/accounts': {
          get: { operationId: 'SearchGETRest20', responses: { '200': { description: 'ok' } } },
        },
        '/contacts': {
          get: { operationId: 'SearchGETRest20', responses: { '200': { description: 'ok' } } },
        },
      },
    };
    const result = generateV3Wrekenfile(v3Spec, __dirname);
    const parsed = yamlLoad(result) as any;
    const endpoints = Object.values<any>(parsed.METHODS).map((m) => m.HTTP.ENDPOINT).sort();
    expect(endpoints).toEqual(['/accounts', '/contacts']);
  });
});

describe('inline object response schema without explicit "type": "object"', () => {
  it('registers a STRUCT (Swagger v2) instead of emitting a bare OBJECT literal', () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'typeless-object', version: '1.0' },
      host: 'example.com',
      basePath: '/',
      paths: {
        '/accounts/lists': {
          get: {
            operationId: 'GetAccountListSearch',
            responses: {
              '200': {
                description: 'ok',
                schema: {
                  // No "type": "object" — properties alone should still be
                  // treated as a struct, as it commonly is in the wild.
                  properties: {
                    count: { type: 'integer' },
                    items: {
                      type: 'array',
                      items: { $ref: '#/definitions/AccountList' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      definitions: {
        AccountList: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };

    const result = generateV2Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    const method = Object.values<any>(parsed.METHODS)[0];
    const returnType = method.RETURNS[0].RETURNTYPE;

    expect(returnType).toMatch(/^STRUCT\(/);
    expect(returnType).not.toBe('OBJECT');

    const structName = returnType.slice('STRUCT('.length, -1);
    expect(parsed.STRUCTS[structName]).toBeDefined();
    expect(parsed.STRUCTS['AccountList']).toBeDefined();
  });

  it('registers a STRUCT (OpenAPI v3) instead of emitting a bare OBJECT literal', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'typeless-object', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/accounts/lists': {
          get: {
            operationId: 'GetAccountListSearch',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        count: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    const method = Object.values<any>(parsed.METHODS)[0];
    const returnType = method.RETURNS[0].RETURNTYPE;

    expect(returnType).toMatch(/^STRUCT\(/);
    expect(returnType).not.toBe('OBJECT');

    const structName = returnType.slice('STRUCT('.length, -1);
    expect(parsed.STRUCTS[structName]).toBeDefined();
  });
});

describe('OpenAPI v3 request body content-type ordering', () => {
  it('finds the JSON request body even when it is not the first declared content type', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'content-type-order', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/widgets': {
          post: {
            operationId: 'createWidget',
            requestBody: {
              required: true,
              content: {
                // XML declared before JSON — the body used to be skipped
                // entirely because extractRequestBody only looked at the
                // first key of `content`.
                'application/xml': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    };

    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;
    const method = Object.values<any>(parsed.METHODS)[0];
    const bodyInput = method.INPUTS.find((i: any) => i.body);

    expect(bodyInput).toBeDefined();
    expect(bodyInput.body.TYPE).toMatch(/^STRUCT\(/);
  });
});

describe('inline struct name collisions across unrelated endpoints', () => {
  it('keeps distinct fields for endpoints whose canonical id would otherwise collapse to the same name', () => {
    // Both endpoints share method+resource+"lists" shape (only the
    // account/contact segment differs, which the old canonical-id-based
    // struct naming ignored), so they used to generate the exact same
    // struct name and one endpoint's fields silently clobbered the other's.
    const spec = {
      swagger: '2.0',
      info: { title: 'collision', version: '1.0' },
      host: 'example.com',
      basePath: '/',
      paths: {
        '/api/bulk/2.0/accounts/lists': {
          get: {
            operationId: 'GetAccountListSearch',
            responses: {
              '200': {
                description: 'ok',
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/definitions/AccountList' } },
                  },
                },
              },
            },
          },
        },
        '/api/bulk/2.0/contacts/lists': {
          get: {
            operationId: 'GetContactListSearch',
            responses: {
              '200': {
                description: 'ok',
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/definitions/ContactList' } },
                  },
                },
              },
            },
          },
        },
      },
      definitions: {
        AccountList: { type: 'object', properties: { accountId: { type: 'string' } } },
        ContactList: { type: 'object', properties: { contactId: { type: 'string' } } },
      },
    };

    const result = generateV2Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;

    expect(parsed.STRUCTS['AccountList']).toBeDefined();
    expect(parsed.STRUCTS['ContactList']).toBeDefined();

    const methods = Object.values<any>(parsed.METHODS);
    const accountMethod = methods.find((m) => m.HTTP.ENDPOINT === '/api/bulk/2.0/accounts/lists');
    const contactMethod = methods.find((m) => m.HTTP.ENDPOINT === '/api/bulk/2.0/contacts/lists');
    expect(accountMethod).toBeDefined();
    expect(contactMethod).toBeDefined();
    expect(accountMethod.RETURNS[0].RETURNTYPE).not.toBe(contactMethod.RETURNS[0].RETURNTYPE);

    const accountStructName = accountMethod.RETURNS[0].RETURNTYPE.slice('STRUCT('.length, -1);
    const contactStructName = contactMethod.RETURNS[0].RETURNTYPE.slice('STRUCT('.length, -1);
    expect(accountStructName).not.toBe(contactStructName);

    const accountItemsField = parsed.STRUCTS[accountStructName].find((f: any) => f.name === 'items');
    const contactItemsField = parsed.STRUCTS[contactStructName].find((f: any) => f.name === 'items');
    expect(accountItemsField.TYPE).toBe('[]STRUCT(AccountList)');
    expect(contactItemsField.TYPE).toBe('[]STRUCT(ContactList)');
  });
});

describe('allOf-wrapped single $ref properties (e.g. { allOf: [{ $ref: X }], description })', () => {
  it('reuses the referenced struct instead of duplicating its fields under a derived name', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'allof-wrapper', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/comments': {
          get: {
            operationId: 'getComments',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Comment' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Comment: {
            type: 'object',
            properties: {
              body: { type: 'string' },
              author: {
                // Common idiom: allOf-wrap a $ref purely to attach a sibling
                // "description" key. Should behave exactly like a direct
                // $ref to User, not generate a duplicate "Comment_author".
                allOf: [{ $ref: '#/components/schemas/User' }],
                description: 'the comment author',
              },
            },
          },
          User: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    };

    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;

    const authorField = parsed.STRUCTS['Comment'].find((f: any) => f.name === 'author');
    expect(authorField.TYPE).toBe('STRUCT(User)');
    expect(authorField.comment).toBe('the comment author');
    expect(parsed.STRUCTS['Comment_author']).toBeUndefined();
    expect(parsed.STRUCTS['User']).toBeDefined();
  });

  it('resolves a self-referential allOf-wrapped property without a dangling ref', () => {
    // Regression: a property that allOf-wraps a $ref back to its own
    // containing schema (real example: Jira's NotificationEvent.templateEvent)
    // used to generate an ever-growing derived name
    // (Self_prop_prop_prop_...) that a recursion depth cap had to truncate,
    // leaving one dangling STRUCT reference. Resolving it to the schema's
    // own name instead lets the existing dedupe-by-name cache break the
    // cycle naturally, with zero dangling refs.
    const spec = {
      openapi: '3.0.0',
      info: { title: 'self-ref-allof', version: '1.0' },
      servers: [{ url: 'https://example.com' }],
      paths: {
        '/events': {
          get: {
            operationId: 'getEvents',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotificationEvent' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          NotificationEvent: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              templateEvent: {
                allOf: [{ $ref: '#/components/schemas/NotificationEvent' }],
                description: 'the base event this one derives from',
              },
            },
          },
        },
      },
    };

    const result = generateV3Wrekenfile(spec, __dirname);
    const parsed = yamlLoad(result) as any;

    const templateEventField = parsed.STRUCTS['NotificationEvent'].find((f: any) => f.name === 'templateEvent');
    expect(templateEventField.TYPE).toBe('STRUCT(NotificationEvent)');

    const structNames = new Set(Object.keys(parsed.STRUCTS));
    const referenced = new Set<string>();
    const re = /STRUCT\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    for (const fields of Object.values<any[]>(parsed.STRUCTS)) {
      for (const field of fields) {
        while ((match = re.exec(field.TYPE)) !== null) referenced.add(match[1]);
      }
    }
    const dangling = [...referenced].filter((n) => !structNames.has(n));
    expect(dangling).toEqual([]);
  });
});
