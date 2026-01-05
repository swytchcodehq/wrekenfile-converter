# Wrekenfile v2.0.1

> **Status**: Stable
>
> **Purpose**: A language-agnostic, semantic specification for APIs and SDKs that enables LLMs and tools (e.g. Swytchcode) to generate correct, end-to-end code workflows without relying on language-specific syntax.
>
> **Note**: This specification includes support for documenting external types (types from dependencies, standard libraries, or third-party packages) with source information to enable complete, location-agnostic wrekenfiles.

---

## Core Design Principles

1. **Semantics over syntax**  
   Wrekenfile describes *what* a callable does and *how it behaves*, not *how it is written* in a specific programming language.

2. **Language-agnostic**  
   No language keywords such as `new`, `await`, `async`, `Promise`, etc. appear in the spec.

3. **Single source of truth**  
   Function names, inputs, execution behavior, and return values are defined exactly once.

4. **Workflow-first**  
   Return values can feed into subsequent calls. Dependencies are explicit.

5. **LLM-readable by default**  
   Every callable contains sufficient structured context (`SUMMARY`, `INPUTS`, `EXECUTION`) for reliable reasoning.

---

## File Rules

1. Accepted filenames: `Wrekenfile.yaml` or `Wrekenfile.yml`
2. YAML format is mandatory
3. GraphQL is not supported in this version
4. OpenAPI / Swagger support is optional and external

---

## Top-Level Structure

```yaml
VERSION
DEFAULTS
SOURCES
UTILITIES
CONSTRUCTORS
METHODS
STRUCTS
TESTS
```

---

## 1. VERSION (Mandatory)

Defines the schema version of the Wrekenfile.

```yaml
VERSION: "2.0.1"
```

**Note**: This version adds error semantics, optional parameters, pagination support, method overloading guidance, and external type documentation for real-world SDK handling.

---

## 2. DEFAULTS (Optional)

Global constants and environment variables available across the entire workflow.

```yaml
DEFAULTS:
  userid: 1
  amount: 100.0
  bearer_token: "BEARER abcd"
  w_base_url: "https://library.api"
```

Rules:
- Method-level DEFAULTS override global DEFAULTS
- `w_base_url` must not contain a trailing slash

---

## 3. SOURCES (Optional)

Defines where symbols (classes, functions, clients) originate from, without leaking language-specific import syntax.

### Purpose
- Decouples *what* is used from *how* it is imported
- Enables correct multi-language code generation
- Allows import de-duplication across workflows

### Rules
- SOURCES define **origins**, not syntax
- Methods and constructors may reference exactly one SOURCE (or an array, rarely)
- HTTP-only methods typically do not require a SOURCE

### Structure

```yaml
SOURCES:
  <alias>:
    KIND: package | runtime | local
    IDENTIFIERS:
      - <symbol-name>
    LOCATOR:
      <language>: <import-path>
```

### Example

```yaml
SOURCES:
  library-sdk:
    KIND: package
    IDENTIFIERS:
      - Library
      - make_payment
    LOCATOR:
      npm: "@payments/library"
      pypi: "payments_library"
      go: "github.com/vendor/package"
      maven: "com.payments:library"
```

---

## 4. UTILITIES (Optional)

Side-effect-free helper functions that do not depend on other Wrekenfile callables.

Rules:
- No INPUTS dependency on other methods
- Used for timestamps, UUIDs, hashing, etc.

```yaml
UTILITIES:
  current-date:
    SUMMARY: "Generate the current timestamp"
    RETURNS:
      - RETURNTYPE: TIMESTAMP
        RETURNVAR: currentDate
```

---

## 5. CONSTRUCTORS (Optional)

Constructors and factories create instances required by instance methods.

### Key Concepts
- Covers `new Class()`, `Class()`, `NewClass()` across languages
- Syntax-free and semantic

### Required Sections

```yaml
CONSTRUCTORS:
  library:
    SUMMARY: "Initialize the payment library client"

    SOURCE: library-sdk

    INTERFACE:
      NAME: Library

    INVOCATION:
      TYPE: constructor

    INPUTS:
      - config: STRUCT(LIBRARY_CONFIG)

    RETURNS:
      - RETURNTYPE: STRUCT(LIBRARY)
        RETURNVAR: lib
```

---

## 6. METHODS (Mandatory)

Defines all callable SDK methods and HTTP APIs.

Each method must explicitly define:
- Callable identity
- Invocation semantics
- Execution behavior

---

### Per-Method Sections

#### ALIAS (YAML key)
Programmatic identifier (lowercase, hyphen/underscore allowed).

```yaml
make-payment:
```

---

#### SUMMARY (Mandatory)
One-line, imperative description of what the method does.

```yaml
SUMMARY: "Make a payment for a product"
```

---

#### DESC (Optional)
Extended behavioral description.

---

#### INTERFACE (Mandatory for SDK / function methods)

Defines the callable symbol name in the SDK.

```yaml
SOURCE: library-sdk

INTERFACE:
  NAME: make_payment
```

Rules:
- No arguments allowed
- No language keywords
- Forbidden for pure HTTP methods

---

#### INVOCATION (Mandatory)

Defines how the callable is invoked.

```yaml
INVOCATION:
  TYPE: instance | static | function | constructor
  RECEIVER: LIBRARY   # Required when TYPE = instance or static
```

---

#### REQUIRES (Optional)

Explicit dependencies that must exist before invocation.

```yaml
REQUIRES:
  - INSTANCE: LIBRARY
```

---

#### EXECUTION (Mandatory)

Defines completion semantics.

```yaml
EXECUTION:
  MODE: sync | async | fire_and_forget
```

---

#### ASYNC (Required when MODE = async)

```yaml
ASYNC:
  RETURNS: result | job | stream
  RESULT:
    TYPE: STRUCT(PAYMENT)
```

| RETURNS | Meaning |
|------|---------|
| result | Awaitable final value |
| job | Long-running operation requiring polling |
| stream | Continuous stream of items |

---

#### INPUTS (Optional)

Defines input parameters and their types.

**Simple form** (REQUIRED defaults to true):
```yaml
INPUTS:
  - userid: INT
  - amount: FLOAT
```

**Extended form** (with optional parameters):
```yaml
INPUTS:
  - userid:
      TYPE: INT
      REQUIRED: true
  - coupon:
      TYPE: STRING
      REQUIRED: false
  - currency:
      TYPE: STRING
      REQUIRED: false
      DEFAULT: "USD"
```

**Rules:**
- `REQUIRED: true` is the default if not specified
- Optional parameters enable correct form generation, validation, and call signatures
- `DEFAULTS` section can also provide default values (method-level overrides global)

---

#### DEFAULTS (Optional)

Method-specific defaults overriding global DEFAULTS.

---

#### HTTP (Optional – for API methods)

```yaml
HTTP:
  METHOD: GET | POST | PUT | DELETE
  ENDPOINT: "/payment-methods"
  HEADERS:
    Authorization: bearer_token
  BODYTYPE: raw | form-data | x-www-form-urlencoded
```

Notes:
- `w_base_url` is automatically prepended
- HTTP methods default to `EXECUTION.MODE: async`

---

#### RETURNS (Optional)

Defines successful return values.

**Rules:**
- RETURNS section should be **omitted** for functions that return void/None/undefined
- If a function has no return value, the RETURNS section should not be included
- RETURNS is only needed when the function actually returns a value
- Functions that return void/None/undefined are considered to have no return value

**Examples:**

Function with return value:
```yaml
RETURNS:
  - RETURNTYPE: STRUCT(PAYMENT)
    RETURNVAR: payment_status
```

Function with paginated return:
```yaml
RETURNS:
  - RETURNTYPE: STRUCT(USER_LIST)
    RETURNVAR: users
    PAGINATION:
      TYPE: cursor
      CURSOR_FIELD: next_cursor
```

**PAGINATION** (Optional, when return type supports pagination):
- `TYPE`: `cursor` | `offset` | `page` | `iterator`
- `CURSOR_FIELD`: Field name containing the cursor/continuation token
- `OFFSET_FIELD`: Field name containing offset value (for offset-based pagination)
- `PAGE_SIZE_FIELD`: Field name containing page size (for page-based pagination)

This enables LLMs to generate proper iteration loops, not one-shot calls.

Void function (RETURNS section omitted):
```yaml
# No RETURNS section - function returns void
```

---

#### ERRORS (Optional)

Defines failure behavior and error types that may be raised/thrown/returned.

**Why this matters:**
- LLMs need to generate proper try/catch or error handling
- Tests need to validate failure scenarios
- SDK parity requires modeling both success and failure paths

**Examples:**

```yaml
ERRORS:
  - TYPE: STRUCT(PAYMENT_ERROR)
    WHEN: "Card is declined"
  - TYPE: STRUCT(AUTH_ERROR)
    WHEN: "Invalid API key"
  - TYPE: STRUCT(VALIDATION_ERROR)
    WHEN: "Invalid input parameters"
```

**Rules:**
- ERRORS are optional but recommended for methods that can fail
- `TYPE` should reference a STRUCT defined in the STRUCTS section (or be ANY for untyped errors)
- `WHEN` provides a human-readable description of when this error occurs
- Multiple error types can be specified for different failure scenarios

**Language mapping:**
- Go: `error` return values → ERRORS section
- Java: `throws` declarations → ERRORS section
- TypeScript: Promise rejections → ERRORS section
- Python: `raise` exceptions → ERRORS section

---

#### Method Overloading / Variants

SDKs often expose multiple methods with the same name but different parameter shapes.

**Recommended approach (Option A):**

Model overloads as separate aliases with the same INTERFACE name:

```yaml
METHODS:
  create-user-basic:
    SUMMARY: "Create a user with minimal parameters"
    INTERFACE:
      NAME: create
    INPUTS:
      - userid: STRING
      - email: STRING

  create-user-advanced:
    SUMMARY: "Create a user with full options"
    INTERFACE:
      NAME: create
    INPUTS:
      - options: STRUCT(USER_OPTIONS)
```

This approach:
- Keeps the spec simple and flat
- Allows parsers to extract each variant independently
- Enables LLMs to choose the appropriate variant based on available inputs
- Maintains clear separation between alias (unique) and interface name (can repeat)

---

### Complete Method Example

```yaml
make-payment:
  SUMMARY: "Make a payment for a product"

  SOURCE: library-sdk

  INTERFACE:
    NAME: make_payment

  INVOCATION:
    TYPE: instance
    RECEIVER: LIBRARY

  REQUIRES:
    - INSTANCE: LIBRARY

  EXECUTION:
    MODE: async

  ASYNC:
    RETURNS: result
    RESULT:
      TYPE: STRUCT(PAYMENT)

  INPUTS:
    - userid:
        TYPE: INT
        REQUIRED: true
    - amount:
        TYPE: FLOAT
        REQUIRED: true
    - cardtype:
        TYPE: STRING
        REQUIRED: true
    - coupon:
        TYPE: STRING
        REQUIRED: false
    - currency:
        TYPE: STRING
        REQUIRED: false
        DEFAULT: "USD"

  RETURNS:
    - RETURNTYPE: STRUCT(PAYMENT)
      RETURNVAR: payment_status

  ERRORS:
    - TYPE: STRUCT(PAYMENT_ERROR)
      WHEN: "Card is declined or insufficient funds"
    - TYPE: STRUCT(AUTH_ERROR)
      WHEN: "Invalid API key or expired session"
```

---

## 7. STRUCTS (Optional)

User-defined structured types.

**Guidelines:**
- STRUCTS are optional, but **strongly recommended** for all STRUCT() references
- **Return types (RETURNS section) SHOULD have definitions** when available in source code
- Only structs with **at least one field** should be included
- Empty structs (interfaces without fields, abstract types) should be omitted
- External library types (standard library, third-party dependencies) should be documented with source information

**Struct Field Structure:**

Each struct field can have the following properties:

```yaml
STRUCTS:
  LIBRARY_CONFIG:
    - name: api_key
      type: STRING
      REQUIRED: true  # Optional, defaults to true
      comment: "Optional comment describing the field"  # Optional, for documentation
```

**External Types:**
External library types (types from dependencies, standard libraries, or third-party packages) should be documented with their source information:

1. **Document with source package** (Recommended):
   When a struct type is referenced but not defined in the parsed source code, parsers should add it to STRUCTS with a `comment` field indicating its source:
   
   ```yaml
   STRUCTS:
     Config:
       - name: _note
         type: STRING
         comment: "External type from package: aws-sdk-go or similar config library"
     
     PrivateKey:
       - name: _note
         type: STRING
         comment: "External type from package: crypto/rsa or crypto/ecdsa"
   ```

2. **Omit** (Alternative for truly unknown types):
   - Types from standard libraries may be omitted if source cannot be determined
   - Types from third-party libraries may be omitted if definition and source are unavailable

3. **Use ANY** (Fallback for truly unknown types):
   ```yaml
   RETURNS:
     - RETURNTYPE: ANY  # Instead of STRUCT(UnknownType)
   ```

**External Type Documentation Rules:**
- Parsers should attempt to extract source package information from qualified type names (e.g., `crypto/rsa.PrivateKey` → package: `crypto/rsa`)
- When source package is available, it should be included in the `comment` field
- When source package is not available, parsers may infer common external types (e.g., `PrivateKey` → likely from crypto library)
- The `_note` field with type `STRING` is used as a placeholder to satisfy the "at least one field" requirement while documenting external types

**Note**: Parsers should prioritize extracting definitions from source code. External types that cannot be extracted should be documented with their source information when possible, or omitted if source cannot be determined.

**Examples:**

Internal structs (defined in source code):
```yaml
STRUCTS:
  LIBRARY_CONFIG:
    - name: api_key
      type: STRING
      REQUIRED: true

  LIBRARY:
    - name: name
      type: STRING
    - name: version
      type: STRING

  PAYMENT:
    - name: uid
      type: STRING
    - name: status
      type: BOOL
    - name: payment_date
      type: TIMESTAMP
```

External structs (from dependencies):
```yaml
STRUCTS:
  Config:
    - name: _note
      type: STRING
      comment: "External type from package: aws-sdk-go or similar config library"
  
  PrivateKey:
    - name: _note
      type: STRING
      comment: "External type from package: crypto/rsa or crypto/ecdsa"
  
  PublicKey:
    - name: _note
      type: STRING
      comment: "External type from package: crypto/rsa or crypto/ecdsa"
```

---

## 8. Type System

### Primitive Types

STRING | INT | FLOAT | BOOL | TIMESTAMP | DATE | TIME | NULL | UNDEFINED | VOID | ANY | OBJECT

- **STRING**: Text/string values
- **INT**: Integer numbers
- **FLOAT**: Floating-point numbers
- **BOOL**: Boolean values (true/false)
- **TIMESTAMP**: Date/time values
- **DATE**: Date values
- **TIME**: Time values
- **NULL**: Null value
- **UNDEFINED**: Undefined value
- **VOID**: No return value (for functions that return nothing)
- **ANY**: Unknown or dynamic type
- **OBJECT**: Generic object/dictionary with unknown structure (for truly generic key-value pairs)

### Composite Types

#### Arrays
- **`[]TYPE`**: Array/list of TYPE
  - Example: `[]STRING` (array of strings), `[]INT` (array of integers)
  - Example: `[]STRUCT(User)` (array of User structs)

#### Maps
- **`map[KEY]VALUE`**: Map/dictionary with KEY type keys and VALUE type values
  - Example: `map[STRING]STRING` (dictionary with string keys and string values)
  - Example: `map[STRING]INT` (dictionary with string keys and integer values)
  - Example: `map[STRING]STRUCT(User)` (dictionary with string keys and User struct values)
  - Example: `map[STRING]ANY` (dictionary with string keys and any type values)

#### Structs
- **`STRUCT(Name)`**: Reference to a struct defined in the STRUCTS section
  - Example: `STRUCT(PAYMENT)` (reference to PAYMENT struct)
  - Example: `STRUCT(USER_CONFIG)` (reference to USER_CONFIG struct)

### Type Examples

**Language mappings:**
- Python: `Dict[str, str]` → `map[STRING]STRING`
- Python: `Dict[str, Any]` → `map[STRING]ANY` or `OBJECT`
- Python: `List[str]` → `[]STRING`
- Python: `object` → `OBJECT`
- Java: `Map<String, String>` → `map[STRING]STRING`
- Java: `List<String>` → `[]STRING`
- TypeScript: `Record<string, string>` → `map[STRING]STRING`
- TypeScript: `string[]` → `[]STRING`
- Go: `map[string]string` → `map[STRING]STRING`
- Go: `[]string` → `[]STRING`

---

## 9. TESTS (Optional)

Natural-language workflow tests used for validation and demo generation.

```yaml
TESTS:
  NLP:
    - "Generate code to make a payment using Visa card and fetch payment details"
    - "Get all payment methods"
```

---

## Explicitly Forbidden

The following must never appear in a Wrekenfile:

- `new`
- `await`
- Language-specific async keywords
- Inline executable code
- Parentheses in INTERFACE definitions
- Language-specific import syntax (`import`, `require`, `using`, etc.)

---

## Final Notes

Wrekenfile v2.0.1 models **callable identity**, **dependency**, and **execution semantics** separately.

This separation is what enables:
- Multi-language code generation
- Deterministic AST → spec mapping
- Reliable LLM reasoning
- Workflow planning and MCP integration

### Changes from v2.0.0

1. **RETURNS section**: Clarified that void/None/undefined functions should omit RETURNS section
2. **STRUCTS section**: Added guidance on external types, empty structs, and return type definitions
3. **Primitive types**: Added VOID to the primitive types list
4. **INPUTS section**: Added `REQUIRED` field to support optional parameters (defaults to `true`)
5. **ERRORS section**: Added optional ERRORS section to model failure behavior and error types
6. **RETURNS section**: Added optional `PAGINATION` hints for paginated/iterable return types
7. **Method overloading**: Documented recommended approach for handling method variants/overloads
8. **Clarifications**: Enhanced guidance for parsers and code generators
9. **External struct documentation**: Added `comment` field to struct fields for documenting external types with their source packages

### Real-World SDK Handling

This version addresses critical gaps that appear when parsing real-world SDKs:

- **Error semantics**: Models exceptions, error returns, and typed errors across languages
- **Optional parameters**: Enables correct form generation, validation, and call signatures
- **Method overloading**: Handles multiple methods with same name but different parameter shapes
- **Pagination**: Supports cursors, offsets, and iterators for list-based operations

These additions ensure workflows are not optimistically wrong and enable proper error handling, validation, and iteration patterns.

This version should be treated as the baseline moving forward.
