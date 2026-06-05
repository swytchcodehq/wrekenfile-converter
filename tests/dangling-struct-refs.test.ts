import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import { generateWrekenfile } from '../src/v2/openapi-to-wreken';

/**
 * Regression tests for the "dangling STRUCT references" bug surfaced on the
 * Podcast Index demo (conorbronsdon/wrekenfile-converter#5). Every
 * `STRUCT(Name)` the converter emits must have a matching definition under
 * `STRUCTS:` — otherwise the resulting Wrekenfile is not self-describing and
 * LLM consumers can't resolve the type.
 */

function collectDanglingRefs(wrekenfileText: string): string[] {
  const refRe = /STRUCT\(([^)]+)\)/g;
  const refs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(wrekenfileText)) !== null) {
    if (m[1]) refs.add(m[1]);
  }

  const structsIdx = wrekenfileText.indexOf('STRUCTS:');
  const structsBlock = structsIdx >= 0 ? wrekenfileText.slice(structsIdx) : '';
  const defRe = /^  ([A-Za-z0-9_.]+):/gm;
  const defined = new Set<string>();
  while ((m = defRe.exec(structsBlock)) !== null) {
    if (m[1]) defined.add(m[1]);
  }

  return [...refs].filter((r) => !defined.has(r)).sort();
}

describe('dangling STRUCT reference regressions', () => {
  it('registers a struct definition for shared error responses (components.responses.400)', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/x': {
          get: {
            operationId: 'getX',
            responses: {
              '200': { description: 'ok' },
              '400': { $ref: '#/components/responses/400' },
            },
          },
        },
      },
      components: {
        responses: {
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    const out = generateWrekenfile(spec, __dirname);
    expect(collectDanglingRefs(out)).toEqual([]);
    const parsed = yamlLoad(out) as any;
    expect(parsed.STRUCTS?.Error400).toBeDefined();
    expect(parsed.STRUCTS.Error400.map((f: any) => f.name).sort()).toEqual([
      'description',
      'status',
    ]);
  });

  it('emits a primitive error type when the error schema is not an object', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/x': {
          get: {
            operationId: 'getX',
            responses: {
              '200': { description: 'ok' },
              '401': { $ref: '#/components/responses/401' },
            },
          },
        },
      },
      components: {
        responses: {
          '401': {
            description: 'Not authenticated',
            content: {
              'application/json': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const out = generateWrekenfile(spec, __dirname);
    expect(collectDanglingRefs(out)).toEqual([]);
    const parsed = yamlLoad(out) as any;
    const method = parsed.METHODS[Object.keys(parsed.METHODS)[0]];
    const e401 = method.ERRORS.find((e: any) => e.STATUS === 401);
    expect(e401.TYPE).toBe('STRING');
  });

  it('resolves an additionalProperties-only schema $ref as map[STRING]X (not dangling STRUCT)', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/x': {
          post: {
            operationId: 'postX',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/guids' },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          guids: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    };

    const out = generateWrekenfile(spec, __dirname);
    expect(collectDanglingRefs(out)).toEqual([]);
    const parsed = yamlLoad(out) as any;
    const method = parsed.METHODS[Object.keys(parsed.METHODS)[0]];
    expect(method.HTTP.BODY.TYPE).toBe('map[STRING][]STRING');
  });

  it('resolves a propertyless object schema $ref as OBJECT (not dangling STRUCT)', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/x': {
          get: {
            operationId: 'getX',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        categories: { $ref: '#/components/schemas/categories' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          categories: {
            type: 'object',
            description: 'Free-form categories map',
          },
        },
      },
    };

    const out = generateWrekenfile(spec, __dirname);
    expect(collectDanglingRefs(out)).toEqual([]);
    const parsed = yamlLoad(out) as any;
    const responseStructName = Object.keys(parsed.STRUCTS).find((k) =>
      k.endsWith('Response200')
    );
    expect(responseStructName).toBeDefined();
    const responseStruct = parsed.STRUCTS[responseStructName!];
    const categoriesField = responseStruct.find((f: any) => f.name === 'categories');
    expect(categoriesField.type).toBe('OBJECT');
  });

  it('gives per-operation truly-inline error schemas operation-scoped names', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            responses: {
              '200': { description: 'ok' },
              '400': {
                description: 'bad',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { a_field: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            operationId: 'getB',
            responses: {
              '200': { description: 'ok' },
              '400': {
                description: 'bad',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { b_field: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const out = generateWrekenfile(spec, __dirname);
    expect(collectDanglingRefs(out)).toEqual([]);
    const parsed = yamlLoad(out) as any;
    // Two different inline 400 schemas should get two different struct names,
    // not collide on `Error400`.
    expect(parsed.STRUCTS.getA_Error400).toBeDefined();
    expect(parsed.STRUCTS.getB_Error400).toBeDefined();
    expect(parsed.STRUCTS.getA_Error400.map((f: any) => f.name)).toEqual(['a_field']);
    expect(parsed.STRUCTS.getB_Error400.map((f: any) => f.name)).toEqual(['b_field']);
  });

  it('podcastindex spec has zero dangling STRUCT references', () => {
    const fs = require('fs');
    const path = require('path');
    const specPath = path.join(__dirname, '..', 'demo', 'podcastindex-api.json');
    if (!fs.existsSync(specPath)) return; // demo spec absent in isolated environments
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const out = generateWrekenfile(spec, path.dirname(specPath));
    expect(collectDanglingRefs(out)).toEqual([]);
  });
});
