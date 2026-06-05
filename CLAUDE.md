# wrekenfile-converter

Convert OpenAPI and Postman specs into Wrekenfiles, with chunking for vector database storage. Fork of swytchcode/wrekenfile-converter.

## Architecture
- `src/v1/` — V1 converter (OpenAPI 3.x to Wrekenfile)
- `src/v2/` — V2 converter with CLI tools, supports OpenAPI 2/3 and Postman collections
- `src/v2/cli/` — CLI entry points (wrekenfile, wrekenfile-v2, wrekenfile-postman, wrekenfile-mini)
- `src/index.ts` — Package exports
- `src/versions.ts` — Version detection and routing
- `tests/` — 12 Vitest test suites with JSON/YAML fixtures in tests/fixtures/

## Key constraints
- Fork of swytchcode/wrekenfile-converter — keep upstream compatibility in mind
- Multiple export paths (v1, v2, validator, mini-generator) — changes may affect any consumer
- Specification files in `specification/` define the Wrekenfile format

## Development
```bash
npm ci
npm run lint    # tsc --noEmit (type-check)
npm run build   # tsc (outputs to dist/)
npm test        # vitest run
```

## Testing
12 test suites covering converters, utilities, and edge cases. Fixtures in tests/fixtures/.

## Agent workflow
- Always work on a branch. Never push directly to main.
- Create PRs targeting main. CI must pass (lint + build + test on Node 20 and 22).
- Keep changes focused — one feature or fix per PR.
- Run `npm test` locally before pushing.
