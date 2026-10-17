# Wreken Specification v2.1.0

> **Status:** Stable (HTTP + SDK Unified)
> **Audience:** API teams, SDK authors, AI systems (LLMs), tooling platforms
> **Goal:** Fully define how APIs and SDKs are **called**, **constructed**, and **executed** — without inference.

### Changes in 2.1.0

Additive; every valid 2.0.2 Wrekenfile is a valid 2.1.0 Wrekenfile.

- A new top-level `SIGNING` block holds request-signing recipes for APIs that need a fresh signature on every call, such as crypto exchanges (see section 15).
- A new SECURITY type, `request_signature`, names a recipe. A method is signed only when its `SECURITY` lists one.
- Headers and parameters that a recipe produces are left out of `HEADERS`, `INPUTS` and `DEFAULTS`. This is an exception to the rule in section 14 that a header's value must name a `DEFAULTS` key.

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
VERSION: 2.1.0

CLIENTS:
METHODS:
STRUCTS:
SOURCES:
DEFAULTS:
SIGNING:
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
        Authorization: bearer_token   # a DEFAULTS key, see Auth header references
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

`CURSOR_FIELD`, `OFFSET_FIELD` and `PAGE_SIZE_FIELD` hold the **name** of a property in
the response or request (e.g. `PAGE_SIZE_FIELD: pageSize`), never a schema or a value.

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
  bearer_token: Bearer <TOKEN>
```

### Auth header references

An auth header's value in `HTTP.HEADERS` is the name of a `DEFAULTS` key, never a
literal credential. The `DEFAULTS` entry holds a placeholder template showing the
expected format:

```yaml
DEFAULTS:
  bearer_token: Bearer <TOKEN>   # Authorization scheme is "Bearer", not "BEARER"
  x-api-key: <X-API-KEY>
METHODS:
  example.thing.get:
    HTTP:
      HEADERS:
        Authorization: bearer_token
        X-API-Key: x-api-key
```

- Every key a header references must exist in `DEFAULTS`, except for headers a `SIGNING` recipe produces, which are not listed at all (see section 15).
- Runtimes must not send a referenced value as-is; they substitute the real credential
  or omit the header.
- Credentials sent in the query or a cookie (`apiKey` with `in: query` / `in: cookie`)
  appear as an optional `LOCATION: query` / `LOCATION: cookie` input and in `SECURITY`,
  not in `HEADERS`. A runtime sends `LOCATION: cookie` inputs as `Cookie` header pairs
  and never in the URL.

---

## 15. SECURITY and SIGNING

### 15.1 SECURITY

A method's `SECURITY` lists the acceptable ways to authenticate it. Each list entry is one option and maps scheme names to their details. A scheme's `type` is one of `apiKey`, `http`, `oauth2`, `openIdConnect`, or `request_signature`. `SECURITY: []`, or no `SECURITY` at all, means the method needs no credential.

```yaml
SECURITY:
  - ApiKeyAuth: {type: apiKey, in: header, name: X-API-Key}
```

### 15.2 Signed requests

Some APIs, crypto exchanges in particular, reject a fixed credential. For each request the caller has to:

- generate a timestamp or nonce;
- build a message from parts of the request (method, path, query, body);
- sign that message with a secret;
- place the results in headers, query parameters or the body.

A `request_signature` scheme names a recipe in the top-level `SIGNING` block that says how to do this:

```yaml
SIGNING:
  coinswitch_signature:
    version: 1
    credentials:
      - {name: api_key, label: API key}
      - {name: secret_key, label: Secret key, secret: true, encoding: hex}
    steps:
      - {id: ts, op: time, unit: ms}
      - {id: msg, op: concat, parts: ['{method}', '{path_query_decoded}', '{ts}']}
      - {id: sig, op: sign, alg: ed25519, key: secret_key, input: '{msg}', output: hex}
    set:
      headers:
        X-AUTH-APIKEY: '{api_key}'
        X-AUTH-EPOCH: '{ts}'
        X-AUTH-SIGNATURE: '{sig}'

METHODS:
  coinswitch.order.create:
    HTTP:
      METHOD: POST
      ENDPOINT: /trade/api/v2/order
      HEADERS:
        Content-Type: application/json   # X-AUTH-* are not listed: the signer adds them
    SECURITY:
      - coinswitch_signature: {type: request_signature}
  coinswitch.time.get:
    HTTP:
      METHOD: GET
      ENDPOINT: /trade/api/v2/time
    SECURITY: []                          # public: sent unsigned
```

Rules:

1. A `request_signature` entry in `SECURITY` must name a recipe that exists in `SIGNING`.
2. A method is signed only when its `SECURITY` lists a `request_signature` scheme. A method with `SECURITY: []` is sent unsigned.
3. Headers, query parameters and body fields that a recipe's `inject` or `set` produces (for example a timestamp, nonce, signature or API key) **must not** appear in `HEADERS` or `INPUTS`, and have **no** `DEFAULTS` entry. Runtimes and AI consumers must never ask the caller for them.
4. Credential values never appear in a Wrekenfile. `credentials` only names the fields a user enters when connecting.
5. A recipe's keys use the same lowercase names as the `x-swytchcode-signing` OpenAPI extension it is usually converted from, so the recipe can be copied verbatim. A platform may store the recipe it actually runs elsewhere. In that case `SIGNING` describes what the source spec declares.

### 15.3 Recipe format (version 1)

| Field | Meaning |
|---|---|
| `version` | Recipe format version. A consumer must reject a version it does not support. |
| `credentials` | The fields the user enters: `name`, `label`, `secret` (hidden input), `encoding` (`utf8`, `hex`, `base64` or `pem`), and `optional`. |
| `steps` | Named values computed in order, each with an `id` and an `op` (see below). |
| `inject` | `query` and `body_fields` added **before** the message is built, so they are signed (e.g. `timestamp`, `recvWindow`, `nonce`). Each field has a `name` and a `value` template, plus an optional `type` (`number` for a JSON body) and `position` (`first` or `last`, the default). |
| `set` | `headers`, `query` and `body_fields` added **after** signing. `body: empty` sends no body. |
| `sensitive` | Extra names whose values must be redacted. Anything built from a credential or a signature is already sensitive. |
| `rules` | An optional list of schemes chosen by `host` and/or `path_prefix`, for providers that sign differently per host. |
| `verify` | An optional read-only `{method, path}` used to check credentials when they are entered. |
| `time_sync` | An optional `{path, json_path, unit, on_error, proactive}` for reading the provider's clock. |

Values are templates: literal text plus `{name}` placeholders, where `{{` and `}}` stand for literal braces. A placeholder can name:

- a credential;
- a step `id`;
- a request input: `method`, `method_lower`, `host`, `path`, `query`, `query_decoded`, `query_sorted`, `path_query`, `path_query_decoded`, `body` or `content_type`.

`query` and `body` are the exact bytes sent.

| `op` | Produces |
|---|---|
| `time` | The current time: `unit` is `ms`, `s`, `us`, `iso8601_ms`, `iso8601_s` or `iso8601_s_nozone`. |
| `expires` | The current time plus `seconds`. |
| `nonce` | `monotonic_us`, `monotonic_ms` (strictly increasing per key), `uuid4`, or `random_hex`. |
| `literal` | A constant `value`. |
| `concat` | `parts` joined by `separator`. Binary-safe. |
| `hash` | `sha256`, `sha384` or `sha512` of `input`. |
| `hmac` | An HMAC of `input` with `key` (a credential or step). |
| `sign` | An `ed25519` or `rsa_pkcs1_sha256` signature of `input` with a credential `key`. |
| `jwt` | A JWT (`ES256`, `EdDSA`, `HS256`, `HS512`) built from `header` and `claims` templates, with an optional `lifetime`. |
| `encode` | `base64`, `base64url`, `hex` or `urlencode` of `input`. |
| `canonical_params` | Parameters in a canonical form: `sorted_urlencoded` or `sorted_kv_concat`, from `query`, `body` or `body.<field>`; or `json_query`, a JSON body as `key=value` pairs in body order. |
| `trim_prefix` | `input` without `prefix`. |

`hash`, `hmac` and `sign` take an `output` of `raw`, `hex`, `hex_upper`, `base64` or `base64url`.

A recipe can only combine these building blocks. There is no expression language, and a consumer must reject an `op`, unit, algorithm or option it does not know rather than guess.

---

## 16. Void / Empty Returns

If a method returns no value:
- Omit `RETURNS`
- The method is treated as `void`

---

## 17. Relationship to Mini-Wrekenfiles

- Full Wrekenfile = **authoritative source of truth**
- Mini-Wrekenfile = **usage-focused projection**
- Mini files must never redefine CLIENTS, STRUCTS, or HTTP details

---

## 18. AI & Code Generation Rules (Normative)

Consumers of this spec **MUST**:

1. Never infer missing fields
2. Respect INPUTS.LOCATION
3. Never invent client initialization
4. Generate direct calls only
5. Treat this spec as authoritative

---

## 19. License

MIT

