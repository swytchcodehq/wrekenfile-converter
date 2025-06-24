# Wrekenfile Converter (Library)

A comprehensive TypeScript/JavaScript library for converting OpenAPI specifications (v2 and v3) and Postman collections into [Wrekenfile](./wrekenfile.md) YAML format, with advanced mini-chunking capabilities for vector database storage and AI context management.

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

### Importing the Library

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
console.log(result.isValid ? '✅ Valid' : '❌ Invalid');
console.log(result.errors, result.warnings);
```

### Generate Mini Wrekenfiles

```typescript
import { generateMiniWrekenfiles, MiniWrekenfile } from 'wrekenfile-converter';

const miniFiles: MiniWrekenfile[] = generateMiniWrekenfiles('./Wrekenfile.yaml');
// Each miniFile contains { content, metadata }
```

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
├── index.ts                    # Main exports
├── openapi-to-wreken.ts        # OpenAPI v3 converter
├── openapi-v2-to-wrekenfile.ts # OpenAPI v2 converter
├── postman-to-wrekenfile.ts    # Postman converter
├── wrekenfile-validator.ts     # Validation logic
├── mini-wrekenfile-generator.ts # Mini chunk generator
└── example-usage.ts            # Usage examples

dist/                           # Compiled JavaScript + types
├── index.js
├── index.d.ts
└── ... (all compiled files)

mini-wrekenfiles/               # Generated mini chunks (if you save them)
├── mini-v2-app-projects.yaml
├── mini-v2-app-authenticate.yaml
└── ...
```

## License

MIT 