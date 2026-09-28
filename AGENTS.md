# Agent Guidelines

Read `AI_RULES.md` and `FEATURES.md` before making any changes.

- Zero npm dependencies (Node.js 22 built-ins only, ADR 001).
- Fast commands `#` go to `src/commands.js` (no LLM).
- Always verify with `npm test` before concluding tasks. Never weaken or delete existing tests.
