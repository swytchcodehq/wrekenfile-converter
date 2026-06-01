<div align="center">

# Wrekenfile Converter

Convert OpenAPI and Postman specs into execution-first Wrekenfiles for AI agents and LLM code generation.

[![GitHub stars](https://img.shields.io/github/stars/conorbronsdon/wrekenfile-converter?style=social)](https://github.com/conorbronsdon/wrekenfile-converter/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/wrekenfile-converter?style=flat-square)](https://www.npmjs.com/package/wrekenfile-converter)
[![CI](https://github.com/conorbronsdon/wrekenfile-converter/actions/workflows/ci.yml/badge.svg)](https://github.com/conorbronsdon/wrekenfile-converter/actions/workflows/ci.yml)

[![Wreken Spec](https://img.shields.io/badge/Wreken-v2.0.2-purple?style=flat-square)](https://wreken.com)
[![Swytchcode](https://img.shields.io/badge/by-Swytchcode-orange?style=flat-square)](https://www.swytchcode.com/)

[Demo](https://github.com/conorbronsdon/wrekenfile-demo) | [Wreken Spec](https://wreken.com) | [npm](https://www.npmjs.com/package/wrekenfile-converter) | [Issues](https://github.com/conorbronsdon/wrekenfile-converter/issues)

</div>

---

A TypeScript/JavaScript library for converting OpenAPI specifications (v2 and v3) and Postman collections into **Wrekenfiles**, declarative YAML artifacts that act as the single source of truth for API methods, workflows, headers, and responses.
Generated Wrekenfiles are compliant with the [**Wreken Specification v2.0.2**](./src/v2/wreken_specification_v_2_0%202.md) and support advanced mini-chunking for vector database storage and AI context management.

**See a real-world example:** [wrekenfile-demo](https://github.com/conorbronsdon/wrekenfile-demo) — Podcast Index API (50 endpoints, 228 schemas) converted to a full Wrekenfile + 52 mini-wrekenfiles.

## Features

- **Multi-format Support**: Convert OpenAPI v2 (Swagger), OpenAPI v3, and Postman collections
- **Wrekenfile v2.0.2 Compliant**: Generates Wrekenfiles compliant with the Wreken Specification v2.0.2 (latest)
- **Complete Response Handling**: All response types (success and error) included in `RETURNS` arrays with `STATUS` codes
- **Proper Parameter Structure**: Path parameters in `ENDPOINT`, header parameters in `HTTP.HEADERS`, query and body parameters in `INPUTS` with `LOCATION` field
- **HTTP Details**: Includes `HTTP.CONTENT_TYPE`, `HTTP.ACCEPT`, `HTTP.BODY.TYPE`, and `HTTP.HEADERS` for complete HTTP execution context
- **Execution Metadata**: Includes `EXECUTION.KIND` (http/sdk/hybrid) and `EXECUTION.MODE` (sync/async/fire_and_forget)
- **Authentication Handling**: Auth headers (Authorization, X-API-Key, etc.) are properly mapped to `HEADERS` with placeholder values
- **Comprehensive Error Handling**: Detailed error messages with context and error codes for invalid inputs, all errors include `STATUS` codes
- **AI-Optimized**: Response structs explicitly referenced for easy AI consumption
- **Standalone Mini Wrekenfiles**: Generate execution-complete, standalone mini-wrekenfiles (one per method) for vector DB storage and LLM code generation
- **TypeScript Support**: Full TypeScript definitions and exports
- **Subproject Ready**: Designed to work as a dependency in larger projects

## Installation

### As a Dependency (Recommended)

```bash
npm install wrekenfile-converter
```

or

```bash
yarn add wrekenfile-converter
```

## Usage

### Version Support

This library supports two Wrekenfile versions:
- **v1** based on Wreken Specification 1.2 (legacy)
- **v2** based on Wreken Specification 2.0.2 (latest)

### Importing the Library

**Default import (v1, for backward compatibility):**
```typescript
import {
  generateWrekenfile, // OpenAPI v3
  generateWrekenfileV2, // OpenAPI v2 (Swagger)
  generateWrekenfileFromPostman, // Postman collections
  validateWrekenfile,
  generateMiniWrekenfiles,
  MiniWrekenfile,
  ValidationResult
} from 'wrekenfile-converter';
```

**Recommended: Use v2 (latest Wrekenfile spec 2.0.2):**
```typescript
import {
  generateWrekenfile, // OpenAPI v3
  generateWrekenfileV2, // OpenAPI v2 (Swagger)
  generateWrekenfileFromPostman, // Postman collections
  generateMiniWrekenfiles,
  MiniWrekenfile
} from 'wrekenfile-converter/v2';
```

**Explicit version imports:**
```typescript
// Import v1 (Wrekenfile spec 1.2)
import { generateWrekenfile } from 'wrekenfile-converter/v1';

// Import v2 (Wrekenfile spec 2.0.2) - Recommended
import { generateWrekenfile } from 'wrekenfile-converter/v2';
```

### Convert OpenAPI v3 to Wrekenfile

```typescript
import fs from 'fs';
import yaml from 'js-yaml';
import { generateWrekenfile } from 'wrekenfile-converter/v2';

const fileContent = fs.readFileSync('./openapi.yaml', 'utf8');
const openapiSpec = yaml.load(fileContent);
const wrekenfileYaml = generateWrekenfile(openapiSpec, './');
```

### Convert OpenAPI v2 (Swagger) to Wrekenfile

```typescript
import fs from 'fs';
import yaml from 'js-yaml';
import { generateWrekenfile } from 'wrekenfile-converter/v2';

const fileContent = fs.readFileSync('./swagger.yaml', 'utf8');
const swaggerSpec = yaml.load(fileContent);
const wrekenfileYaml = generateWrekenfile(swaggerSpec, './');
```

### Convert Postman Collection to Wrekenfile

```typescript
import fs from 'fs';
import { generateWrekenfileFromPostman } from 'wrekenfile-converter/v2';

const collection = JSON.parse(fs.readFileSync('./collection.json', 'utf8'));
const variables = {}; // Optionally provide Postman environment variables
const wrekenfileYaml = generateWrekenfileFromPostman(collection, variables);
```

### Validate a Wrekenfile

```typescript
import { validateWrekenfile } from 'wrekenfile-converter';

const result = validateWrekenfile('./Wrekenfile.yaml');
console.log(result.isValid ? 'Valid' : 'Invalid');
console.log(result.errors, result.warnings);
```

### Generate Mini Wrekenfiles

```typescript
import { generateMiniWrekenfiles, MiniWrekenfile } from 'wrekenfile-converter/v2';

const wrekenfileYaml = generateWrekenfile(openapiSpec, './');
const miniFiles: MiniWrekenfile[] = generateMiniWrekenfiles(wrekenfileYaml);
// Each miniFile contains { content, metadata }
// One mini-wrekenfile is generated per method (standalone, execution-complete)
```

**Note**: Mini-wrekenfiles are now **standalone and execution-complete**, meaning each mini-wrekenfile contains all necessary information (HTTP details, SDK details, structs, inputs with LOCATION, returns, errors) for an LLM to generate execution code without external references. They follow the [Unified Mini-Wrekenfile Specification v2.0](./specification/unified_mini_wrekenfile_spec_v_2.md).

## CANONICAL_ID (Stable Method Identifier)

Generated Wrekenfiles use `CANONICAL_ID` as the **method key** in the `METHODS` section, providing a stable, semantic identifier for each API method.

- **Method Keys**: Methods are keyed by their `CANONICAL_ID` (e.g., `METHODS.api.cluster.get`)
- **Format**: `<namespace>.<resource>.<action>` (example: `api.cluster.get`)
- **Deterministic**: derived from `HTTP.METHOD` + `HTTP.ENDPOINT` (no LLM)
- **No path params**: `{id}` etc. are excluded from the identifier
- **Collision-safe**: if two methods would produce the same canonical ID, the generator deterministically appends a short hash to keep IDs unique
- **RETURNVAR**: Return variable names are derived from `CANONICAL_ID` (dots replaced with underscores, e.g., `api_cluster_get` for status 200, `api_cluster_get_404` for error responses)
- **Struct Names**: Inline request/response struct names are aligned with `CANONICAL_ID` (e.g., `api.cluster.getRequest`, `api.cluster.getResponse200`)
- **Struct Filtering**: Unused struct definitions are automatically removed from the generated Wrekenfile

Example:

```yaml
METHODS:
  api.cluster.get:
    CANONICAL_ID: api.cluster.get
    HTTP:
      METHOD: GET
      ENDPOINT: /api/clusters/{id}
    RETURNS:
      - TYPE: STRUCT(api.cluster.getResponse200)
        RETURNVAR: api_cluster_get
        STATUS: 200
```

The full deterministic spec (for re-implementing in SDKs/other languages) is documented in [`specification/canonical_id.md`](./specification/canonical_id.md).

## Parameter Structure

The converter properly structures parameters according to the Wrekenfile v2.0.2 specification:

- **Path Parameters** (e.g., `/users/{userId}`): Included in the `ENDPOINT` field only, not in `INPUTS`
- **Header Parameters** (e.g., `Authorization`, `X-Request-Id`): Included in `HTTP.HEADERS` only, not in `INPUTS`
- **Query Parameters**: Included in `INPUTS` section with `LOCATION: query`
- **Body Parameters**: Included in `INPUTS` section with `LOCATION: body` (e.g., `body: STRUCT(RequestType)`)

All input parameters include a `LOCATION` field to clearly indicate where they should be placed in the HTTP request. The `HTTP.BODY.TYPE` field indicates the content type for body parameters (e.g., `application/json`, `application/x-www-form-urlencoded`).

This ensures proper separation of concerns and follows the Wrekenfile specification correctly.

## Error Handling

The converters include comprehensive error handling with detailed error messages:

- **Validation Errors**: Invalid specifications are caught early with descriptive error messages
- **Error Codes**: Structured error codes (e.g., `INVALID_SPEC_TYPE`, `MISSING_OPENAPI_VERSION`) for programmatic handling
- **Context Logging**: Errors include full context (spec title, version, file paths, etc.) for debugging
- **Stack Traces**: Full stack traces are logged for development and debugging
- **Status Codes**: All errors in the generated Wrekenfile include `STATUS` codes (e.g., `400`, `404`, `500`)

All errors are logged to the console with timestamps and context information. The generated Wrekenfiles include `STATUS` codes in both `RETURNS` and `ERRORS` sections for complete HTTP response handling.

## CLI Tools

The CLI tools are available for both v1 and v2. The examples below use v2 (latest), which generates Wrekenfile spec 2.0.2.

### Convert OpenAPI v3 to Wrekenfile

```bash
wrekenfile --input <openapi.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]
```

**Options:**
- `--input` or `-i`: Path to your OpenAPI v3 YAML or JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--cwd`: Working directory for resolving $refs (optional, defaults to the input file's directory)

**Example:**
```bash
wrekenfile --input petstore.json --output petstore_wrekenfile.yaml
```

### Convert OpenAPI v2 (Swagger) to Wrekenfile

```bash
wrekenfile-v2 --input <swagger.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]
```

**Options:**
- `--input` or `-i`: Path to your OpenAPI v2/Swagger YAML or JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--cwd`: Working directory for resolving $refs (optional, defaults to the input file's directory)

**Example:**
```bash
wrekenfile-v2 --input swagger.json --output api_wrekenfile.yaml
```

### Convert Postman Collection to Wrekenfile

```bash
wrekenfile-postman --input <postman_collection.json> [--output <wrekenfile.yaml>] [--env <environment.json>]
```

**Options:**
- `--input` or `-i`: Path to your Postman collection JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--env` or `-e`: Path to Postman environment file (optional)

**Example:**
```bash
wrekenfile-postman --input collection.json --output api_wrekenfile.yaml --env environment.json
```

### Generate Mini Wrekenfiles

Generate standalone, execution-complete mini Wrekenfiles (one per method) from a main Wrekenfile YAML:

```bash
wrekenfile-mini --input <wrekenfile.yaml> [--output <dir>]
```

**Options:**
- `--input` or `-i`: Path to your main Wrekenfile YAML (required)
- `--output` or `-o`: Output directory for mini Wrekenfiles (optional, defaults to `./mini-wrekenfiles`)

**Example:**
```bash
wrekenfile-mini --input petstore_wrekenfile.yaml --output ./mini-wrekenfiles
```

Each mini-wrekenfile is execution-complete and includes all necessary details (HTTP, SDK, INPUTS with LOCATION, RETURNS, ERRORS, STRUCTS) for LLM code generation without external references.

## API Reference

### Core Functions

#### `generateWrekenfile(spec: any, baseDir: string): string`
Convert OpenAPI v3 specification to Wrekenfile format.

#### `generateWrekenfileV2(spec: any, baseDir: string): string`
Convert OpenAPI v2 (Swagger) specification to Wrekenfile format.

#### `generateWrekenfileFromPostman(collection: any, variables: Record<string, string>): string`
Convert Postman collection to Wrekenfile format.

#### `validateWrekenfile(filePath: string): ValidationResult`
Validate a Wrekenfile and return detailed results.

#### `generateMiniWrekenfiles(wrekenfileContent: string): MiniWrekenfile[]`
Generate standalone, execution-complete mini Wrekenfiles (one per method). Takes the full Wrekenfile YAML content as a string and returns an array of mini-wrekenfiles.

### Types

#### `MiniWrekenfile`
```typescript
interface MiniWrekenfile {
  content: string;           // Complete YAML content (standalone, execution-complete)
  metadata: {
    endpoint?: string;       // API endpoint path (if applicable)
    interface?: string;      // SDK interface name (if applicable)
    source?: string;         // Source identifier
    methods: string[];       // HTTP methods (GET, POST, etc.)
    structs: string[];      // Required struct names (included in mini-wrekenfile)
    filename: string;        // Generated filename
  };
}
```

**Note**: Each mini-wrekenfile is standalone and execution-complete, containing:
- `METHOD` section with `ID`, `SUMMARY`, and `DESC`
- `EXECUTION` section with `KIND`, `MODE`, and `EXECUTION_LEVEL: standalone`
- `HTTP` section with `METHOD`, `ENDPOINT`, `CONTENT_TYPE`, `ACCEPT`, and `HEADERS`
- `SDK` section (if applicable) with `INTERFACE.NAME` and `INVOCATION`
- `INPUTS` with `LOCATION` field for each parameter
- `RETURNS` as a single object with `TYPE` and `DESC`
- `ERRORS` array with `STATUS` codes
- `STRUCTS` section with full struct definitions (recursively collected)

#### `ValidationResult`
```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
```

## Development

### Build Commands

```bash
# Build TypeScript to dist/
npm run build

# Clean dist folder
npm run clean

# Watch mode for development
npm run dev

# Run example usage
npm run example
```

### Project Structure

```
src/
├── index.ts                        # Main exports (defaults to v1)
├── example-usage.ts                # Usage examples
├── versions.ts                     # Version constants
├── v1/                             # Wrekenfile spec v1.2
│   ├── index.ts
│   ├── openapi-to-wreken.ts
│   ├── openapi-v2-to-wrekenfile.ts
│   ├── postman-to-wrekenfile.ts
│   ├── mini-wrekenfile-generator.ts
│   ├── wrekenfile-validator.ts
│   └── cli/                        # CLI tools for v1
└── v2/                             # Wreken spec v2.0.2
    ├── index.ts
    ├── openapi-to-wreken.ts
    ├── openapi-v2-to-wrekenfile.ts
    ├── postman-to-wrekenfile.ts
    ├── mini-wrekenfile-generator.ts
    ├── utils/                      # Utility functions
    │   ├── canonical-id.ts        # Deterministic canonical ID generation
    │   ├── constants.ts           # Shared constants (auth, headers, types)
    │   ├── error-utils.ts         # Error handling and spec validation
    │   ├── response-utils.ts      # RETURNVAR and error message generation
    │   ├── struct-utils.ts        # Struct filtering by usage
    │   ├── summary-utils.ts       # Operation summary generation
    │   ├── type-utils.ts          # OpenAPI → Wrekenfile type mapping
    │   └── yaml-utils.ts          # YAML generation and validation pipeline
    └── cli/                        # CLI tools for v2

dist/                               # Compiled JavaScript + types
├── index.js
├── v1/
└── v2/
```

## About

The [Wreken specification](https://wreken.com) and wrekenfile-converter are created by [Swytchcode Technologies](https://www.swytchcode.com/). Wreken is an execution-first YAML spec for converting APIs into LLM-friendly tool definitions. Learn more at [wreken.com](https://wreken.com).

This fork is maintained by [Conor Bronsdon](https://github.com/conorbronsdon) and includes CLI improvements, test coverage, and a [real-world demo](https://github.com/conorbronsdon/wrekenfile-demo) of the converter against the Podcast Index API as testing for the [Chain of Thought Podcast](https://chainofthought.transistor.fm/).

---

## Disclaimer

*All views, opinions, and statements expressed on this account are solely my own and are made in my personal capacity. They do not reflect, and should not be construed as reflecting, the views, positions, or policies of Modular. This account is not affiliated with, authorized by, or endorsed by Modular in any way.*

## License

MIT
