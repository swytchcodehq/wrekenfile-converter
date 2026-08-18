import { describe, it, expect } from 'vitest';
import { generateWrekenfile } from '../src/v2/openapi-to-wreken';
import { load as yamlLoad } from 'js-yaml';

describe('OpenAPI constraints preservation', () => {
  it('preserves REQUIRED, ENUM, FORMAT, MINIMUM, MAXIMUM, PATTERN, NULLABLE', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'testOp',
            parameters: [
              {
                name: 'id',
                in: 'query',
                required: true,
                schema: {
                  type: 'string',
                  format: 'uuid',
                  pattern: '^[0-9a-f]{8}-',
                  nullable: true
                }
              },
              {
                name: 'status',
                in: 'query',
                required: false,
                schema: {
                  type: 'string',
                  enum: ['active', 'inactive']
                }
              }
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['count'],
                    properties: {
                      count: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 100
                      }
                    }
                  }
                }
              }
            },
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
    };

    const result = generateWrekenfile(spec, '/tmp');
    const parsed = yamlLoad(result) as any;
    
    // Check method INPUTS
    const method = parsed.METHODS['test.test.create'];
    expect(method).toBeDefined();
    const inputs = method.INPUTS;
    
    // id parameter
    const idParam = inputs.find((i: any) => i.id)?.id;
    expect(idParam.REQUIRED).toBe(true);
    expect(idParam.FORMAT).toBe('uuid');
    expect(idParam.PATTERN).toBe('^[0-9a-f]{8}-');
    expect(idParam.NULLABLE).toBe(true);
    
    // status parameter
    const statusParam = inputs.find((i: any) => i.status)?.status;
    expect(statusParam.REQUIRED).toBe(false);
    expect(statusParam.ENUM).toEqual(['active', 'inactive']);
    
    // body parameter (the struct reference)
    const bodyParam = inputs.find((i: any) => i.body)?.body;
    expect(bodyParam.REQUIRED).toBe(true);
    const bodyParamType = bodyParam.TYPE;
    expect(bodyParamType.startsWith('STRUCT(')).toBe(true);
    const structName = bodyParamType.substring(7, bodyParamType.length - 1);

    // Check STRUCTS
    const requestStruct = parsed.STRUCTS[structName];
    expect(requestStruct).toBeDefined();
    
    const countField = requestStruct.find((f: any) => f.name === 'count');
    expect(countField.REQUIRED).toBe(true);
    expect(countField.MINIMUM).toBe(1);
    expect(countField.MAXIMUM).toBe(100);
  });

  it('preserves STYLE, EXPLODE, READ_ONLY, WRITE_ONLY, DEPRECATED, EXAMPLE', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/advanced': {
          post: {
            operationId: 'advancedOp',
            deprecated: true,
            parameters: [
              {
                name: 'tags',
                in: 'query',
                style: 'form',
                explode: true,
                deprecated: true,
                example: ['tag1', 'tag2'],
                schema: { type: 'array', items: { type: 'string' } }
              }
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                        readOnly: true,
                        example: '12345'
                      },
                      password: {
                        type: 'string',
                        writeOnly: true
                      },
                      oldField: {
                        type: 'string',
                        deprecated: true
                      }
                    }
                  }
                }
              }
            },
            responses: { '200': { description: 'Success' } }
          }
        }
      }
    };

    const result = generateWrekenfile(spec, '/tmp');
    const parsed = yamlLoad(result) as any;
    
    // Check method properties
    const method = parsed.METHODS['test.advanced.create'];
    expect(method).toBeDefined();
    expect(method.DEPRECATED).toBe(true);

    const inputs = method.INPUTS;
    
    // tags parameter
    const tagsParam = inputs.find((i: any) => i.tags)?.tags;
    expect(tagsParam.STYLE).toBe('form');
    expect(tagsParam.EXPLODE).toBe(true);
    expect(tagsParam.DEPRECATED).toBe(true);
    expect(tagsParam.EXAMPLE).toEqual(['tag1', 'tag2']);
    
    // Check STRUCTS
    const bodyParam = inputs.find((i: any) => i.body)?.body;
    const bodyParamType = bodyParam.TYPE;
    const structName = bodyParamType.substring(7, bodyParamType.length - 1);
    
    const requestStruct = parsed.STRUCTS[structName];
    expect(requestStruct).toBeDefined();
    
    const idField = requestStruct.find((f: any) => f.name === 'id');
    expect(idField.READ_ONLY).toBe(true);
    expect(idField.EXAMPLE).toBe('12345');
    
    const passField = requestStruct.find((f: any) => f.name === 'password');
    expect(passField.WRITE_ONLY).toBe(true);
    
    const oldField = requestStruct.find((f: any) => f.name === 'oldField');
    expect(oldField.DEPRECATED).toBe(true);
  });
});
