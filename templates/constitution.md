# Engineering Constitution

Every duetto agent (researcher, planner, implementer, reviewer) receives this file. Edit it to encode how
YOU want software built in this repository. Repository instructions in CLAUDE.md / AGENTS.md still apply.

## Architecture
- Prefer existing abstractions and patterns over new infrastructure.
- Prefer incremental changes over broad refactors; no drive-by rewrites.

## Dependencies
- Do not add a dependency without documenting why the existing stack is insufficient.

## Testing
- Every new business rule or bug fix gets a test that would fail without the change.
- Tests must be deterministic (no real network, time or randomness without control).

## Security
- Never read, print or modify secrets (.env, keys, credentials) unless the task explicitly requires it.
- Validate all external input at boundaries.

## UX / product
- Do not introduce new design primitives or user-facing copy patterns without justification.

## Done means
- Code builds, type-checks, lints and tests pass; acceptance criteria are verifiably met.
