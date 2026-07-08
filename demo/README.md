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

## Known issues in this fixture

The checked-in `podcastindex-wrekenfile.yaml` converts cleanly (all 50 endpoints / 52 methods present, CANONICAL_IDs and auth headers correctly extracted), but the response side of the conversion has a gap:

- **Response types are all `VOID`.** The source spec defines 228 response schemas, but the converter doesn't carry them into the output — every one of the 52 methods gets `TYPE: VOID` for its response (52 of the 201 `TYPE:` entries in the file). An LLM can call the API from this Wrekenfile but has no way to know the shape of what comes back.
- **`MODE: async` on every method.** The Podcast Index API is a plain synchronous REST API, so this doesn't match how the endpoints actually behave. Note: `src/v2/openapi-to-wreken.ts` now hardcodes `EXECUTION_MODE_SYNC` for HTTP methods, so this fixture likely predates that change and may just need regenerating — that requires a build and wasn't attempted here.

Filed as reference for anyone extending the converter's response-schema handling.
