# Wrekenfile Converter (Library)
## Version 2.1.0

A comprehensive TypeScript/JavaScript library for converting OpenAPI specifications (v2 and v3) and Postman collections into [Wrekenfile](.src/v2/wrekenfile_v_2_0_1.md) YAML format, with advanced mini-chunking capabilities for vector database storage and AI context management.

## Features

- **Multi-format Support**: Convert OpenAPI v2 (Swagger), OpenAPI v3, and Postman collections
- **Complete Response Handling**: All response types (success and error) included in `RETURNS` arrays
- **AI-Optimized**: Response structs explicitly referenced for easy AI consumption
- **Mini Wrekenfile Generation**: Create focused, endpoint-grouped chunks for vector DB storage
- **Comprehensive Validation**: Built-in Wrekenfile validator with auto-fix capabilities
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

This library supports two Wrekenfile spec versions:
- **v1** (Wrekenfile spec 1.2) - Default/legacy
- **v2** (Wrekenfile spec 2.1.0) - Latest

### Importing the Library

**Default import (currently v1, backward compatible):**
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

**Explicit version imports:**
```typescript
// Import v1 (Wrekenfile spec 1.2)
import { generateWrekenfile } from 'wrekenfile-converter/v1';

// Import v2 (Wrekenfile spec 2.1.0)
import { generateWrekenfile } from 'wrekenfile-converter/v2';
```

### Convert OpenAPI v3 to Wrekenfile

```typescript
import fs from 'fs';
import yaml from 'js-yaml';
import { generateWrekenfile } from 'wrekenfile-converter';

const fileContent = fs.readFileSync('./openapi.yaml', 'utf8');
const openapiSpec = yaml.load(fileContent);
const wrekenfileYaml = generateWrekenfile(openapiSpec, './');
```

### Convert OpenAPI v2 (Swagger) to Wrekenfile

```typescript
import fs from 'fs';
import yaml from 'js-yaml';
import { generateWrekenfile as generateWrekenfileV2 } from 'wrekenfile-converter';

const fileContent = fs.readFileSync('./swagger.yaml', 'utf8');
const swaggerSpec = yaml.load(fileContent);
const wrekenfileYaml = generateWrekenfileV2(swaggerSpec, './');
```

### Convert Postman Collection to Wrekenfile

```typescript
import fs from 'fs';
import { generateWrekenfileFromPostman } from 'wrekenfile-converter';

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
import { generateMiniWrekenfiles, MiniWrekenfile } from 'wrekenfile-converter';

const miniFiles: MiniWrekenfile[] = generateMiniWrekenfiles('./Wrekenfile.yaml');
// Each miniFile contains { content, metadata }
```

## CLI Tools

### Convert OpenAPI to Wrekenfile

Generate a Wrekenfile YAML from an OpenAPI (YAML or JSON) spec:

```bash
npx ts-node src/cli/rest/cli-openapi-to-wrekenfile.ts --input <openapi.yaml|json> [--output <wrekenfile.yaml>] [--cwd <dir>]
```

**Options:**
- `--input` or `-i`: Path to your OpenAPI YAML or JSON file (required)
- `--output` or `-o`: Path to output Wrekenfile YAML (optional, defaults to `output_wrekenfile.yaml`)
- `--cwd`: Working directory for resolving $refs (optional, defaults to the input file's directory)

**Example:**
```bash
npx ts-node src/cli/rest/cli-openapi-to-wrekenfile.ts --input examples/p3id_swagger.json --output wrekenfile.yaml --cwd .
```

### Convert Postman Collection to Wrekenfile

Convert a Postman collection JSON to a Wrekenfile YAML file:

```bash
npx ts-node src/cli/rest/cli-postman-to-wrekenfile.ts <postman_collection.json> <output_wrekenfile.yaml> [postman_environment.json]
```

**Example:**
```bash
npx ts-node src/cli/rest/cli-postman-to-wrekenfile.ts examples/transact_bridge_postman.json wrekenfile.yaml
```

**Note:** The third argument (environment file) is optional.

### Generate Mini Wrekenfiles

Generate mini Wrekenfiles for each endpoint from a main Wrekenfile YAML:

```bash
npx ts-node src/cli/cli-mini-wrekenfile-generator.ts --input <wrekenfile.yaml> [--output <dir>]
```

**Options:**
- `--input` or `-i`: Path to your main Wrekenfile YAML (required)
- `--output` or `-o`: Output directory for mini Wrekenfiles (optional, defaults to `./mini-wrekenfiles`)

**Example:**
```bash
npx ts-node src/cli/cli-mini-wrekenfile-generator.ts --input wrekenfile.yaml --output ./mini-wrekenfiles
```

This will generate one mini Wrekenfile per endpoint in the specified output directory.

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

#### `generateMiniWrekenfiles(wrekenfilePath: string): MiniWrekenfile[]`
Generate mini Wrekenfiles grouped by endpoint.

### Types

#### `MiniWrekenfile`
```typescript
interface MiniWrekenfile {
  content: string;           // Complete YAML content
  metadata: {
    endpoint: string;        // API endpoint path
    methods: string[];       // HTTP methods (GET, POST, etc.)
    structs: string[];       // Required struct names
    filename: string;        // Generated filename
  };
}
```

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
└── v2/                             # Wrekenfile spec v2.1.0
    ├── index.ts
    ├── openapi-to-wreken.ts
    ├── openapi-v2-to-wrekenfile.ts
    ├── postman-to-wrekenfile.ts
    ├── mini-wrekenfile-generator.ts
    └── cli/                        # CLI tools for v2

dist/                               # Compiled JavaScript + types
├── index.js
├── v1/
└── v2/
```

## License

MIT 