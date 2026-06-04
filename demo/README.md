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
