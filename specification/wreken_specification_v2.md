# Wreken Specification v2.0.2

> **Status:** Stable (HTTP + SDK Unified)
> **Audience:** API teams, SDK authors, AI systems (LLMs), tooling platforms
> **Goal:** Fully define how APIs and SDKs are **called**, **constructed**, and **executed** — without inference.

---

## 1. Purpose

A **Wrekenfile** is an execution-first specification that describes *callable intent*.

It unifies:
- HTTP APIs (transport-level execution)
- SDK methods (language-level execution)

into **one authoritative contract** that is:
- Human-readable
- Machine-executable
- AI-safe (no guessing, no hallucination)

---

## 2. Core Design Principles

1. **One method = one intent**
2. **Multiple execution surfaces (HTTP, SDK)**
3. **Client creation is explicit**
4. **Descriptions are mandatory**
5. **No implicit inference**
6. **Mini-specs are projections, not sources of truth**

---

## 3. Top-Level Structure

```yaml
VERSION: 2.0.2

CLIENTS:
METHODS:
STRUCTS:
SOURCES:
DEFAULTS:
```

Only `VERSION` and `METHODS` are required.

---

## 4. CLIENTS (SDK Construction)

Defines how SDK clients are instantiated.

```yaml
CLIENTS:
  SampleSdkClient:
    SUMMARY: Primary SDK client
    DESC: Client used to interact with the Sample service
    CONSTRUCTOR:
      TYPE: instance
      INPUTS:
        - name: api_key
          TYPE: STRING
          REQUIRED: true
          DESC: API key issued by the service
```

**Rules:**
- CLIENTS define *existence*, not usage
- No language imports or syntax allowed

---

## 5. METHODS (Unified HTTP + SDK)

Each method represents a **single logical capability**.

```yaml
METHODS:
  create-user:
    SUMMARY: Create a new user
    DESC: Creates a new user and returns the created entity

    SOURCE: example

    EXECUTION:
      KIND: hybrid        # http | sdk | hybrid
      MODE: async         # sync | async | fire_and_forget

    HTTP:
      METHOD: POST
      ENDPOINT: /users/{id}
      CONTENT_TYPE: application/json
      ACCEPT: application/json
      HEADERS:
        Authorization:
          TYPE: STRING
          DESC: Bearer token for authentication
      BODY:
        TYPE: STRUCT(UserCreateRequest)

    SDK:
      INTERFACE:
        NAME: createUser
      INVOCATION:
        TYPE: instance
        RECEIVER: SampleSdkClient

    INPUTS:
      - name: id
        TYPE: STRING
        REQUIRED: true
        LOCATION: path
        DESC: Unique user identifier
      - name: email
        TYPE: STRING
        REQUIRED: true
        LOCATION: body
        DESC: Email address of the user
      - name: name
        TYPE: STRING
        REQUIRED: false
        LOCATION: body
        DESC: Full name of the user
      - name: request_id
        TYPE: STRING
        REQUIRED: false
        LOCATION: header
        DESC: Optional request correlation ID

    RETURNS:
      - RETURNTYPE: STRUCT(User)
        RETURNVAR: user
        STATUS: 201
        DESC: Created user object

    ERRORS:
      - TYPE: ValidationError
        STATUS: 400
        WHEN: Invalid input values
```

---

## 6. EXECUTION

```yaml
EXECUTION:
  KIND: http | sdk | hybrid
  MODE: sync | async | fire_and_forget
```

Defines how and when execution occurs.

---

## 7. HTTP Section

### 7.1 ENDPOINT

- Supports path parameters using `{param}` syntax
- Path parameters **must** be declared in INPUTS with `LOCATION: path`

### 7.2 BODY

```yaml
BODY:
  TYPE: STRUCT(RequestBody)
```

Defines request body structure.

### 7.3 BODYTYPE (Optional)

```yaml
BODYTYPE: json | form-data | x-www-form-urlencoded
```

If omitted, defaults to `json`.

---

## 8. INPUTS

```yaml
- name: limit
  TYPE: NUMBER
  REQUIRED: false
  DEFAULT: 10
  LOCATION: query
  DESC: Maximum number of items to return
```

### LOCATION (Required for HTTP)

| LOCATION | Meaning |
|--------|--------|
| path | URL path parameter |
| query | Query string parameter |
| body | HTTP request body |
| header | HTTP header |

---

## 9. RETURNS

```yaml
RETURNS:
  - RETURNTYPE: STRUCT(User)
    RETURNVAR: user
    STATUS: 200
    DESC: Returned user object
```

### Streaming Returns

```yaml
RETURNTYPE: STREAM(Event)
```

---

## 10. ERRORS

```yaml
ERRORS:
  - TYPE: NotFoundError
    STATUS: 404
    WHEN: Resource does not exist
```

Errors are descriptive, not executable.

---

## 11. STRUCTS

```yaml
STRUCTS:
  User:
    DESC: Represents a system user
    FIELDS:
      - name: id
        TYPE: STRING
        REQUIRED: true
        DESC: Unique identifier
      - name: email
        TYPE: STRING
        REQUIRED: true
        DESC: Email address
      - name: name
        TYPE: STRING
        REQUIRED: false
        DESC: Display name
```

---

## 12. Pagination (Optional)

```yaml
RETURNS:
  - RETURNTYPE: STRUCT(UserList)
    RETURNVAR: users
    PAGINATION:
      TYPE: cursor      # cursor | offset | page | iterator
      CURSOR_FIELD: next_cursor
```

---

## 13. SOURCES

```yaml
SOURCES:
  example:
    KIND: package
    LOCATOR:
      npm: example-sdk
      python: example_sdk
```

Informational only.

---

## 14. DEFAULTS

```yaml
DEFAULTS:
  w_base_url: https://api.example.com
```

---

## 15. Void / Empty Returns

If a method returns no value:
- Omit `RETURNS`
- The method is treated as `void`

---

## 16. Relationship to Mini-Wrekenfiles

- Full Wrekenfile = **authoritative source of truth**
- Mini-Wrekenfile = **usage-focused projection**
- Mini files must never redefine CLIENTS, STRUCTS, or HTTP details

---

## 17. AI & Code Generation Rules (Normative)

Consumers of this spec **MUST**:

1. Never infer missing fields
2. Respect INPUTS.LOCATION
3. Never invent client initialization
4. Generate direct calls only
5. Treat this spec as authoritative

---

## 18. License

MIT

