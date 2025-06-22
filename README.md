# Wrekenfile Converter

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

### From Source

```bash
git clone <repository-url>
cd wrekenfile-converter
npm install
npm run build
```

## Quick Start

### Command Line Usage

```bash
# Convert OpenAPI v3 spec
npm run convert plaid.yml

# Convert OpenAPI v2 (Swagger) spec  
npm run convert-v2 stripe.yaml

# Convert Postman collection
npm run convert-postman "Swytchcode API Docs.postman_collection.json"

# Validate a Wrekenfile
npm run validate Wrekenfile.yaml

# Generate mini Wrekenfiles for vector DB
npm run mini Wrekenfile.yaml ./mini-chunks
```

### Programmatic Usage

```typescript
import { 
  generateWrekenfile,
  generateWrekenfileV2,
  generateWrekenfileFromPostman,
  validateWrekenfile,
  generateMiniWrekenfiles,
  MiniWrekenfile
} from 'wrekenfile-converter';

// Convert OpenAPI v3
const wrekenfile = generateWrekenfile(openapiSpec, './');

// Convert OpenAPI v2
const wrekenfileV2 = generateWrekenfileV2(swaggerSpec, './');

// Convert Postman collection
const wrekenfilePostman = generateWrekenfileFromPostman(collection, variables);

// Validate Wrekenfile
const validation = validateWrekenfile('./Wrekenfile.yaml');
console.log(validation.isValid ? '✅ Valid' : '❌ Invalid');

// Generate mini Wrekenfiles
const miniFiles: MiniWrekenfile[] = generateMiniWrekenfiles('./Wrekenfile.yaml');
```

## Mini Wrekenfile Generation

The mini Wrekenfile generator creates focused, self-contained chunks perfect for vector database storage and AI context management.

### Features

- **Endpoint Grouping**: All methods for a single endpoint in one file
- **Complete Dependencies**: All required structs and their nested dependencies included
- **Vector DB Ready**: Returns array with content and metadata for batch uploads
- **AI Context Optimized**: Reduces context size from 1000+ lines to 50-200 lines per endpoint

### Usage

```typescript
import { generateMiniWrekenfiles, MiniWrekenfile } from 'wrekenfile-converter';

// Generate all mini Wrekenfiles
const miniWrekenfiles: MiniWrekenfile[] = generateMiniWrekenfiles('./Wrekenfile.yaml');

// Each mini Wrekenfile contains:
// - content: Complete YAML content
// - metadata: { endpoint, methods, structs, filename }

// Prepare for vector DB
const vectorDBData = miniWrekenfiles.map((miniFile, index) => ({
  id: `wrekenfile-chunk-${index}`,
  content: miniFile.content,
  metadata: {
    ...miniFile.metadata,
    source: 'wrekenfile',
    chunk_type: 'endpoint_group',
    created_at: new Date().toISOString()
  }
}));
```

### Example Output

```bash
npm run mini Wrekenfile.yaml

# Generates files like:
# - mini-v2-app-projects.yaml (POST, GET methods)
# - mini-v2-app-authenticate.yaml (POST method)  
# - mini-v2-app-projects-project_uuid.yaml (GET, DELETE methods)
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

mini-wrekenfiles/               # Generated mini chunks
├── mini-v2-app-projects.yaml
├── mini-v2-app-authenticate.yaml
└── ...
```

### Integration as Subproject

This library is designed to work seamlessly as a dependency in larger projects:

```typescript
// In your main project
import { 
  generateMiniWrekenfiles,
  validateWrekenfile 
} from 'wrekenfile-converter';

// Use in your vector DB pipeline
async function processWrekenfile(filePath: string) {
  // Validate first
  const validation = validateWrekenfile(filePath);
  if (!validation.isValid) {
    throw new Error('Invalid Wrekenfile');
  }
  
  // Generate chunks
  const chunks = generateMiniWrekenfiles(filePath);
  
  // Upload to vector DB
  for (const chunk of chunks) {
    await vectorDB.upsert({
      content: chunk.content,
      metadata: chunk.metadata
    });
  }
}
```

## Response Types

All converters include complete response type information:

```yaml
RETURNS:
  - RETURNTYPE: STRUCT(success_response)
    RETURNNAME: response
    CODE: '200'
  - RETURNTYPE: STRUCT(error_400)
    RETURNNAME: response
    CODE: '400'
  - RETURNTYPE: STRUCT(error_403)
    RETURNNAME: response
    CODE: '403'
  - RETURNTYPE: VOID
    RETURNNAME: response
    CODE: '204'
```

This makes it easy for AI systems to find and use the correct response structs for any HTTP status code.

## Wrekenfile Format

The library generates Wrekenfile v1.2 compatible YAML files with:

- **VERSION**: Wrekenfile version
- **INIT**: Default configuration and security settings
- **INTERFACES**: API endpoints with HTTP methods, inputs, and returns
- **STRUCTS**: Data structure definitions

See [wrekenfile.md](./wrekenfile.md) for the complete specification.

## License

MIT 