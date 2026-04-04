# CLAUDE.md

## What This Project Is

**structalign** is a TypeScript implementation of BAML's Schema-Aligned Parsing (SAP) algorithm. It provides LLM-framework-independent structured output parsing: given a raw LLM response (which may contain markdown, chain-of-thought reasoning, or malformed JSON), it extracts and validates a typed value matching a [TypeBox](https://github.com/sinclairzx81/typebox) schema.

This is an **unofficial community migration** of [BoundaryML's BAML](https://www.boundaryml.com) SAP algorithm to TypeScript. The sole runtime dependency is `typebox` ^1.1.6.

---

## Architecture

A three-stage parsing pipeline, all flowing through `parseResponse()`:

```
LLM Response (raw text)
       │
       ▼
1. Chain-of-Thought Filter  [json-extractor.ts]
   Detects and strips reasoning preambles ("let me think", "step by step", etc.)
       │
       ▼
2. JSON Extraction  [json-extractor.ts]
   - Tries markdown code blocks (```json ... ```) first
   - Falls back to direct JSON.parse
   - Finds all JSON-like candidates if needed
   - Auto-fixes: trailing commas, missing commas between properties,
     single→double quotes, Unicode smart quote normalization
   - Recovers partial/incomplete JSON for streaming
       │
       ▼
3. Type Coercion & Validation  [type-coercer.ts]
   - Validates against TypeBox schema using Value.Check
   - Coerces types (string→number, number→string, truthy→boolean, etc.)
   - Selects best-matching union variant by error count
   - Fills optional fields with declared defaults
   - Reports errors with JSON-path locations
       │
       ▼
ParseResult<T> { success, value, errors, isPartial, meta }
```

---

## Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Public API: `parseResponse`, `parsePartialResponse`, `createPromptWithSchema`, `debugParse`, and re-exports of lower-level functions |
| `src/json-extractor.ts` | JSON extraction engine: markdown blocks, multi-candidate search, JSON fixes, smart-quote normalization, CoT detection/filtering |
| `src/type-coercer.ts` | TypeBox coercion and validation: union matching, per-type coercions, constraint checking, error tracking |
| `src/schema-renderer.ts` | TypeBox schema → human-readable prompt instructions (`renderSchema`, `createPromptWithSchema`) |

---

## Development Commands

```bash
pnpm install           # Install dependencies

pnpm run build         # Compile src/ → dist/ (prebuild hook cleans first)
pnpm test              # Build tests + run with Node's built-in test runner
pnpm run example       # Build and run examples/basic-usage.ts

pnpm run check         # Biome lint + format check (read-only, good for CI)
pnpm run check:fix     # Biome auto-fix all issues
pnpm run typecheck     # tsc --noEmit (type-check without emitting)
```

**Full pre-publish validation** (also run automatically by `preversion` hook):
```bash
pnpm run check && pnpm run typecheck && pnpm test
```

---

## Code Conventions

Enforced by [Biome](https://biomejs.dev/) (`biome.json`):

- **Indentation:** Tabs (displayed as 3 spaces)
- **Line width:** 120 characters
- **TypeScript:** Strict mode, `NodeNext` module resolution
- **Test runner:** Node's built-in `node:test` — no Jest, no Vitest

Intentionally disabled Biome rules (used deliberately in coercion/extraction code):
`noNonNullAssertion`, `noExplicitAny`, `noEmptyInterface`, `useNodejsImportProtocol`, `noControlCharactersInRegex`

---

## TypeBox Import Pattern

The project uses TypeBox v1.x, published under the `typebox` npm package name:

```typescript
import Type from 'typebox';                      // default import for schema builders
import type { Static, TSchema } from 'typebox';  // named imports for types

const Schema = Type.Object({ name: Type.String(), age: Type.Number() });
type Schema = Static<typeof Schema>;  // derives TypeScript type from schema
```

---

## Testing

Tests live in `tests/core.test.ts`. Run with:

```bash
pnpm test
```

The test script compiles `tests/` with `tsconfig.test.json` into `dist/tests/`, then runs `node --test dist/tests/*.js`. No watch mode — re-run manually after changes.

Test sections:
1. Schema Renderer
2. JSON Extractor
3. Type Coercer
4. `parseResponse` integration
5. Chain-of-thought detection
6. Complex/nested schemas

**When adding a feature, add at least one test case** to the relevant section.

---

## Where to Make Changes

| Change type | File to edit |
|-------------|-------------|
| New JSON fix strategy | `src/json-extractor.ts` — add fix, push fix name to returned `fixes[]` |
| New CoT pattern | `src/json-extractor.ts` — add to `COT_PATTERNS` array |
| New type coercion | `src/type-coercer.ts` — add to the appropriate `coerceValue` branch |
| New schema type rendering | `src/schema-renderer.ts` — add branch to `renderSchema` |
| New public API function | `src/index.ts` — add to named exports and the default export object |
| New `ParseOptions` field | `src/index.ts` interface + thread through to `extractJson`/`coerceValue` call sites |

---

## Release Process

The `preversion` hook runs `pnpm run check && pnpm test` automatically. Steps:

1. Update `CHANGELOG.md` with the new version entry
2. Run the appropriate release command:

```bash
pnpm run release:patch   # 0.2.2 → 0.2.3  (bug fixes)
pnpm run release:minor   # 0.2.2 → 0.3.0  (new backwards-compatible features)
pnpm run release:major   # 0.2.2 → 1.0.0  (breaking changes)
pnpm run release:dry-run # Preview pack contents without publishing
```

Each release command bumps the version in `package.json`, pushes the commit + tag to GitHub, and publishes to npm.

---

## Project Metadata

- **npm package:** `structalign`
- **Node requirement:** ≥18.0.0
- **Package manager:** pnpm 10.x
- **Runtime dependencies:** `typebox` ^1.1.6 (only one)
- **Dev toolchain:** TypeScript 5.x, Biome 2.x
- **Module formats:** ESM + CJS dual output (via `exports` field in package.json)
