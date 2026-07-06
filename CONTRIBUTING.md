# Contributing

Thanks for your interest in contributing to wrekenfile-converter! This document covers the basics for external contributors.

## Development Setup

```bash
npm ci
npm run lint    # tsc --noEmit (type-check)
npm run build   # tsc (outputs to dist/)
npm test        # vitest run
```

## Workflow

- Always work on a branch — never push directly to `main`.
- Open a pull request targeting `main`. CI must pass (lint + build + test on Node 20 and 22).
- Keep changes focused — one feature or fix per PR.
- Run `npm test` locally before pushing.
- Add or update tests in `tests/` for any behavior change.

## Reporting Issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) for bug reports and feature requests.

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.
