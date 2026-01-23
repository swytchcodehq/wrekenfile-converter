# Unified Mini-Wrekenfile Specification v2.0

## Purpose
The **Unified Mini-Wrekenfile** is a **standalone, execution-complete specification** designed to let humans *and* LLMs generate **correct, deterministic code snippets** for **both HTTP APIs and SDK methods** without resolving any external files.

This spec is intentionally minimal but **semantically complete** at the execution level.

---

## Design Goals

- Execution-complete for **HTTP APIs** and **SDKs**
- Safe for **vector database storage** (Pinecone, etc.)
- No implicit inference or conventions
- No dependency on full Wrekenfiles
- Human-readable and LLM-safe

---

## Versioning

```yaml
VERSION: 2.0.2
```

---

## METHOD

Describes exactly **one executable operation**.

```yaml
METHOD:
  ID: getUser
  SUMMARY: Fetch a user by ID
  DESC: Retrieves a single user using either HTTP or SDK execution.
```

---

## EXECUTION

Defines **how this method is executed**.

```yaml
EXECUTION:
  KIND: http | sdk | hybrid
  MODE: sync | async | fire_and_forget
  EXECUTION_LEVEL: standalone
```

### Field Descriptions
- **KIND**
  - `http` → Generate raw HTTP code
  - `sdk` → Generate SDK usage code
  - `hybrid` → Prefer SDK, fallback to HTTP

- **MODE**
  - `sync` → Blocking execution
  - `async` → Promise / await / future-based

- **EXECUTION_LEVEL**
  - `standalone` → All required data is in this file

---

## HTTP (Optional)

Defines transport details for HTTP execution.

```yaml
HTTP:
  METHOD: GET
  ENDPOINT: /users/{id}
  CONTENT_TYPE: application/json
  ACCEPT: application/json
  HEADERS:
    Authorization:
      TYPE: STRING
      DESC: Bearer token
```

### Notes
- ENDPOINT may include `{path_params}`
- HEADERS are declarative, not values

---

## SDK (Optional)

Defines SDK execution details.

```yaml
SDK:
  INTERFACE:
    NAME: getUser
  INVOCATION:
    TYPE: instance | static | function
    RECEIVER: UserClient
```

### Invocation Types
- **instance** → `client.getUser()`
- **static** → `UserClient.getUser()`
- **function** → `getUser()`

---

## INPUTS

Defines all input parameters.

```yaml
INPUTS:
  - name: id
    TYPE: STRING
    REQUIRED: true
    LOCATION: path
    DESC: User identifier
```

### LOCATION Values
- `path` → URL path parameter
- `query` → URL query string
- `body` → HTTP request body
- `header` → HTTP header
- `sdk` → SDK method argument

---

## RETURNS

Defines return values.

```yaml
RETURNS:
  TYPE: STRUCT(User)
  DESC: User object
```

### Notes
- Omit RETURNS for void methods

---

## ERRORS (Optional)

```yaml
ERRORS:
  - TYPE: NotFoundError
    WHEN: User does not exist
```

---

## STRUCTS

Inline type definitions.

```yaml
STRUCTS:
  User:
    DESC: User model
    FIELDS:
      - name: id
        TYPE: STRING
        REQUIRED: true
        DESC: User ID
```

---

## Guarantees

This mini-wrekenfile guarantees:
- Deterministic code generation
- No hallucinated imports
- No guessing parameter placement
- Full API + SDK parity

---

## Non-Goals

This spec does NOT:
- Define SDK installation
- Generate clients
- Replace the full Wrekenfile

---

## Summary

The Unified Mini-Wrekenfile is the **smallest possible execution-complete contract** for API and SDK code generation.

