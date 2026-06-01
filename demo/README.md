# Wrekenfile Converter Demo: Podcast Index API

Real-world test of the wrekenfile-converter against the [Podcast Index API](https://podcastindex-org.github.io/docs-api/) (OpenAPI 3.0.2 spec, 50 endpoints, 228 response schemas).

## What's here

| File | Description |
|------|-------------|
| `podcastindex-api.json` | Source OpenAPI 3.0.2 spec (from [Podcastindex-org/docs-api](https://github.com/Podcastindex-org/docs-api)) |
| `podcastindex-wrekenfile.yaml` | Converted Wrekenfile v2.0.2 (full API, 2,382 lines) |
| `mini-wrekenfiles/` | 52 standalone mini-wrekenfiles (one per method) |

## How to reproduce

```bash
# Install
npm install wrekenfile-converter

# Convert OpenAPI spec → Wrekenfile
node node_modules/wrekenfile-converter/dist/v2/cli/cli-openapi-to-wrekenfile.js \
  --input demo/podcastindex-api.json \
  --output demo/podcastindex-wrekenfile.yaml

# Generate mini-wrekenfiles for vector DB / LLM context
node node_modules/wrekenfile-converter/dist/v2/cli/cli-mini-wrekenfile-generator.js \
  --input demo/podcastindex-wrekenfile.yaml \
  --output demo/mini-wrekenfiles
```

## Results

**What worked well:**
- All 50 endpoints converted successfully (52 methods — some endpoints have multiple HTTP methods)
- Clean CANONICAL_ID generation (e.g., `search.byperson.list`, `episodes.byfeedid.list`)
- Auth headers correctly extracted from OpenAPI security schemes (`X-Auth-Key`, `X-Auth-Date`, `Authorization`)
- Parameter LOCATION correctly mapped (query params stay query, no hallucination risk)
- Descriptions preserved with full markdown/examples from the source spec
- Mini-wrekenfile generation worked cleanly — each file is standalone and execution-complete
- Fast: full conversion + mini-wrekenfile generation in <1 second

**Issues found:**

| Issue | Severity | Detail |
|-------|----------|--------|
| All response types are `VOID` | High | Source spec has 228 schemas with detailed response structures. Converter drops all of them — `STRUCTS: {}` is empty, every method returns `TYPE: VOID`. An LLM using these wrekenfiles can call the API but can't parse the response. |
| Auth headers inconsistent across methods | Medium | `/search` and `/lookup` have `HEADERS: {}` (correct — spec says no auth needed). But this isn't explicitly documented in the wrekenfile — an LLM wouldn't know *why* headers are empty vs populated. |
| Generic error descriptions | Low | All errors are `WHEN: Client error (HTTP 400)` / `Client error (HTTP 401)`. Source spec has specific error response schemas that could provide better context. |
| `EXECUTION.MODE: async` everywhere | Low | All methods are marked `async` with `ASYNC.RETURNS: result`. The Podcast Index API is synchronous REST — every call returns immediately. |

**The response schema gap is the big one.** The spec defines rich response types (podcast objects, episode objects, search results with counts/descriptions/feed metadata) and the converter throws them all away. For an LLM code generation use case, knowing the response shape is critical for writing code that processes the results.

## Why this API

The Podcast Index API is a good converter test case because:
- Real production API (not a toy spec)
- Mix of authenticated and unauthenticated endpoints
- Rich response schemas (228 types)
- Multiple parameter types (query strings, path params)
- Well-documented OpenAPI 3.0.2 spec

## About

Demo created by [Conor Bronsdon](https://github.com/conorbronsdon) as an external test of the wrekenfile-converter. Issues filed upstream.
