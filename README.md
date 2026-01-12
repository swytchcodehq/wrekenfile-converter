# Wrekenfile Converter

A comprehensive TypeScript/JavaScript library for converting OpenAPI specifications (v2 and v3) and Postman collections into **Wrekenfiles**, declarative YAML artifacts that act as the single source of truth for API methods, workflows, headers, and responses.
Generated Wrekenfiles are compliant with the [**Wreken Specification v2.0.2**](./src/v2/wreken_specification_v_2_0%202.md) and support advanced mini-chunking for vector database storage and AI context management.



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

**Note**: Mini-wrekenfiles are now **standalone and execution-complete**, meaning each mini-wrekenfile contains all necessary information (HTTP details, SDK details, structs, inputs with LOCATION, returns, errors) for an LLM to generate execution code without external references. They follow the [Unified Mini-Wrekenfile Specification v2.0](./src/v2/unified_mini_wrekenfile_spec_v_2.md).

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

Generate a Wrekenfile YAML from an OpenAPI v3 (YAML or JSON) spec:

```bash
npx ts-node src/v2/cli/cli-openapi-to-wrekenfile.ts --input <openapi.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]
```

**Options:**
- `--input` or `-i`: Path to your OpenAPI v3 YAML or JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--cwd`: Working directory for resolving $refs (optional, defaults to the input file's directory)

**Example:**
```bash
npx ts-node src/v2/cli/cli-openapi-to-wrekenfile.ts --input examples/3n.yaml --output 3n_wrekenfile_v2.yaml
```

### Convert OpenAPI v2 (Swagger) to Wrekenfile

Generate a Wrekenfile YAML from an OpenAPI v2/Swagger (YAML or JSON) spec:

```bash
npx ts-node src/v2/cli/cli-openapi-v2-to-wrekenfile.ts --input <swagger.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]
```

**Options:**
- `--input` or `-i`: Path to your OpenAPI v2/Swagger YAML or JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--cwd`: Working directory for resolving $refs (optional, defaults to the input file's directory)

**Example:**
```bash
npx ts-node src/v2/cli/cli-openapi-v2-to-wrekenfile.ts --input examples/5n_v2.yaml --output 5n_v2_wrekenfile.yaml
```

### Convert Postman Collection to Wrekenfile

Convert a Postman collection JSON to a Wrekenfile YAML file:

```bash
npx ts-node src/v2/cli/cli-postman-to-wrekenfile.ts <postman_collection.json> <output_wrekenfile.yaml> [postman_environment.json]
```

**Arguments:**
- `postman_collection.json`: Path to your Postman collection JSON file (required)
- `output_wrekenfile.yaml`: Path to output Wrekenfile YAML (required)
- `postman_environment.json`: Path to Postman environment file (optional)

**Example:**
```bash
npx ts-node src/v2/cli/cli-postman-to-wrekenfile.ts examples/Nium\ APIpostman_collection.json nium_wrekenfile_v2.yaml
```

### Generate Mini Wrekenfiles

Generate standalone, execution-complete mini Wrekenfiles (one per method) from a main Wrekenfile YAML:

```bash
npx ts-node src/v2/cli/cli-mini-wrekenfile-generator.ts --input <wrekenfile.yaml> [--output <dir>]
```

**Options:**
- `--input` or `-i`: Path to your main Wrekenfile YAML (required)
- `--output` or `-o`: Output directory for mini Wrekenfiles (optional, defaults to `./mini-wrekenfiles-v2`)

**Example:**
```bash
npx ts-node src/v2/cli/cli-mini-wrekenfile-generator.ts --input wrekenfile.yaml --output ./mini-wrekenfiles-v2
```

This will generate one standalone mini Wrekenfile per method in the specified output directory. Each mini-wrekenfile is execution-complete and includes all necessary details (HTTP, SDK, INPUTS with LOCATION, RETURNS, ERRORS, STRUCTS) for LLM code generation without external references.

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
└── v2/                             # Wrekenfile spec v2.0.2
    ├── index.ts
    ├── openapi-to-wreken.ts
    ├── openapi-v2-to-wrekenfile.ts
    ├── postman-to-wrekenfile.ts
    ├── mini-wrekenfile-generator.ts
    ├── unified_mini_wrekenfile_spec_v_2.md  # Mini-wrekenfile specification
    ├── utils/                      # Utility functions
    │   ├── yaml-utils.ts          # YAML processing utilities
    │   └── error-utils.ts         # Error handling utilities
    └── cli/                        # CLI tools for v2

dist/                               # Compiled JavaScript + types
├── index.js
├── v1/
└── v2/
```

## License

MIT 