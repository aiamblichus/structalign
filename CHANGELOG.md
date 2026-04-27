# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-04-27

### Fixed
- **Chain-of-thought filter**: Prefer the first ` ```json` fence so preamble stripping cannot jump to a spurious in-body `answer:` match (common in long HTML/JSON). Removed the unanchored `answer:` pattern; added a stricter line-header variant for unfenced `Answer:\n` blocks.
- **`hasChainOfThought` heuristics**: Dropped `therefore` and `first, ` (too many false positives on ordinary structured text). Relying on explicit markers like “let me think”, “step by step”, `reasoning:`, etc.

## [0.2.2] - 2026-04-04

### Added
- Auto-fix missing commas between JSON properties during extraction

## [0.2.1] - 2026-04-04

### Fixed
- `.gitignore` corrections

## [0.2.0] - 2026-04-04

### Changed
- Migrated from `@sinclair/typebox` (0.x) to `typebox` (1.x) — schemas and imports are otherwise unchanged

## [0.1.2] - 2026-02-16

### Fixed
- Apply Unicode smart-quote normalization as a fallback pass only, avoiding mutation of already-valid JSON values that contain typographic quotes
- Preserve strict extraction behavior while still recovering malformed smart-quoted payloads

## [0.1.1] - 2026-02-16

### Added
- Automatic normalization of Unicode smart quotes (`“ ” ‘ ’`) during JSON extraction
- New extraction option `normalizeUnicodeQuotes` (default: `true`)
- Fix metadata marker `normalized_unicode_quotes` when quote normalization is applied

## [0.1.0] - 2025-02-14

### Added
- Initial release as baml-sap-ts (now structalign)
- Schema-Aligned Parsing (SAP) algorithm implementation
- TypeBox integration for schema definition
- JSON extraction from markdown code blocks
- Automatic JSON fixing (trailing commas, missing quotes)
- Chain-of-thought reasoning filtering
- Type coercion and validation
- Union type matching
- Optional field handling with defaults
- Support for partial/streaming responses
- Comprehensive test suite (24 tests)
- Biome linting and formatting
- Full TypeScript support with type declarations

### Features
- `parseResponse()` - Main parsing function
- `createPromptWithSchema()` - Generate prompts with schema instructions
- `extractJson()` - Low-level JSON extraction
- `coerceValue()` - Type coercion against schemas
- `renderSchema()` - Schema to prompt text conversion
- Support for complex nested schemas
- Enum and literal type handling
- Record/map type support
- Tuple type support

[0.2.2]: https://github.com/aiamblichus/structalign/releases/tag/v0.2.2
[0.2.1]: https://github.com/aiamblichus/structalign/releases/tag/v0.2.1
[0.2.0]: https://github.com/aiamblichus/structalign/releases/tag/v0.2.0
[0.1.2]: https://github.com/aiamblichus/structalign/releases/tag/v0.1.2
[0.1.1]: https://github.com/aiamblichus/structalign/releases/tag/v0.1.1
[0.1.0]: https://github.com/aiamblichus/structalign/releases/tag/v0.1.0
