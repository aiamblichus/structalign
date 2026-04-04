# structalign

[![npm version](https://badge.fury.io/js/structalign.svg)](https://www.npmjs.com/package/structalign)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript implementation of BAML's **Schema-Aligned Parsing (SAP)** algorithm using [TypeBox](https://github.com/sinclairzx81/typebox) for schema definition.

> **Note:** StructAlign (formerly `baml-sap-ts`) is an unofficial community migration of BAML's core SAP algorithm. For the official BAML project, visit [boundaryml.com](https://www.boundaryml.com).

## Overview

This package provides **LLM framework independent** structured output parsing - use it with any LLM client (OpenAI, Anthropic, Ollama, etc.).

### What is Schema-Aligned Parsing (SAP)?

SAP is BAML's algorithm for reliably extracting structured outputs from LLMs:

1. **Prompt Rendering**: Auto-generates schema instructions for the LLM
2. **Response Parsing**: Handles malformed JSON, markdown extraction, chain-of-thought filtering
3. **Type Coercion**: Validates and coerces parsed data to the target schema

### Key Features

- ✅ **Markdown code block extraction** - Extract JSON from ` ```json ` blocks
- ✅ **JSON fixing** - Auto-fix trailing commas, missing quotes, etc.
- ✅ **Unicode quote normalization** - Normalize smart quotes (`“ ” ‘ ’`) before parsing
- ✅ **Chain-of-thought filtering** - Remove reasoning text before JSON
- ✅ **Union type matching** - Automatically select best matching variant
- ✅ **Optional fields with defaults** - Handle missing fields gracefully
- ✅ **Type coercion** - Convert strings to numbers, etc.
- ✅ **Partial/streaming support** - Parse incomplete responses
- ✅ **Detailed error reporting** - Know exactly what went wrong
- ✅ **Full TypeScript support** - Type-safe schemas and responses

## Installation

```bash
pnpm add structalign
```

## Quick Start

````typescript
import Type from "typebox";
import { createPromptWithSchema, parseResponse } from "structalign";

// 1. Define your schema
const UserSchema = Type.Object({
  name: Type.String(),
  age: Type.Number(),
  email: Type.Optional(Type.String()),
});

// 2. Create a prompt with schema instructions
const prompt = createPromptWithSchema(
  'Extract user information from: "Alice is 30 years old"',
  UserSchema
);

console.log(prompt);
// Output:
// Extract user information from: "Alice is 30 years old"
//
// Respond with a JSON object in the following format:
//
// ```json
// {
//   "name": string,
//   "age": number,
//   "email": string (optional)
// }
// ```

// 3. Send prompt to LLM and parse response
const response = `Here's the information:

\`\`\`json
{
  "name": "Alice",
  "age": 30
}
\`\`\``;

const result = parseResponse(response, UserSchema);

if (result.success) {
  console.log(result.value); // { name: "Alice", age: 30 }
} else {
  console.error(result.errors);
}
````

## API Reference

### `createPromptWithSchema(basePrompt, schema, options?)`

Appends schema instructions to a base prompt to guide the LLM toward producing correctly structured output.

**Parameters:**

- `basePrompt: string` - Your prompt text
- `schema: TSchema` - TypeBox schema
- `options?: SchemaRenderOptions` - Optional rendering options

**Returns:** `string` - Complete prompt with schema instructions

---

### `parseResponse(response, schema, options?)`

Parse an LLM response into a typed value. This is the main entry point for the SAP algorithm.

**Parameters:**

- `response: string` - Raw LLM response text
- `schema: TSchema` - TypeBox schema to validate against
- `options?: ParseOptions` - Optional parsing options

**Returns:** `ParseResult<T>` - Parsed value with metadata

```typescript
interface ParseResult<T> {
  success: boolean;
  value: T;
  errors: Array<{ path: string; message: string }>;
  isPartial: boolean;
  meta: {
    raw: string;
    fromMarkdown?: boolean;
    chainOfThoughtFiltered?: boolean;
    fixes?: string[];
    coercions?: string[];
  };
}
```

---

### `parsePartialResponse(response, schema, options?)`

For streaming scenarios - parses partial responses with `allowPartials: true`.

---

### `extractJson(text, options?)`

Low-level JSON extraction from text. Handles markdown blocks and malformed JSON.

---

### `coerceValue(value, schema, options?)`

Low-level type coercion and validation against a TypeBox schema.

---

### `validateValue(value, schema)`

Validates a value against a schema without coercion. Returns validation errors.

## Usage Examples

### Chain-of-Thought Reasoning

Automatically detected and filtered:

```typescript
const response = `Let me think step by step...

First, I'll analyze the input. The user mentions they are 25.

Therefore the output JSON is:
\`\`\`json
{"name": "John", "age": 25}
\`\`\``;

const result = parseResponse(response, schema);
console.log(result.meta.chainOfThoughtFiltered); // true
console.log(result.value); // { name: "John", age: 25 }
```

### Malformed JSON

Auto-fixes common issues:

```typescript
const response = '{"name": "test", "age": 25,}'; // trailing comma
const result = parseResponse(response, schema);
console.log(result.meta.fixes); // ['applied_auto_fixes']
console.log(result.value); // { name: "test", age: 25 }
```

### Smart/Unicode Quotes

Normalizes typographic quotes automatically:

```typescript
const response = "{“name”: “test”, “age”: 25}";
const result = parseResponse(response, schema);
console.log(result.meta.fixes); // ['normalized_unicode_quotes']
console.log(result.value); // { name: "test", age: 25 }
```

### Markdown Code Blocks

Extracts JSON from markdown:

````typescript
const response = '```json\n{"key": "value"}\n```';
const result = parseResponse(response, schema);
console.log(result.meta.fromMarkdown); // true
````

### Union Types

Selects best matching variant:

```typescript
const Schema = Type.Union([
  Type.Object({ type: Type.Literal("user"), name: Type.String() }),
  Type.Object({ type: Type.Literal("bot"), id: Type.Number() }),
]);

const result = parseResponse('{"type": "user", "name": "Alice"}', Schema);
// Automatically matches the first variant
```

### Complex Nested Schema

```typescript
const OrderSchema = Type.Object({
  orderId: Type.String(),
  status: Type.Enum({ ORDERED: "ORDERED", SHIPPED: "SHIPPED" }),
  items: Type.Array(
    Type.Object({
      name: Type.String(),
      quantity: Type.Integer({ minimum: 1 }),
      price: Type.Number({ minimum: 0 }),
    })
  ),
  total: Type.Number({ minimum: 0 }),
});

const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [
    {
      role: "user",
      content: createPromptWithSchema("Extract order info", OrderSchema),
    },
  ],
});

const result = parseResponse(response.choices[0].message.content, OrderSchema);
```

## Options

### ParseOptions

```typescript
interface ParseOptions {
  // Extraction options
  allowMarkdownJson?: boolean; // Extract from markdown blocks (default: true)
  allowFixes?: boolean; // Fix malformed JSON (default: true)
  allowAsString?: boolean; // Return string if all fails (default: true)
  findAllJsonObjects?: boolean; // Find multiple JSON objects (default: true)
  normalizeUnicodeQuotes?: boolean; // Normalize “ “ ‘ ‘ to standard quotes (default: true)
  maxDepth?: number; // Max parsing depth (default: 100)

  // Coercion options
  allowPartials?: boolean; // Allow incomplete objects (default: false)
  useDefaults?: boolean; // Use default values (default: true)
  strict?: boolean; // No type coercion (default: false)
  trackCoercions?: boolean; // Track applied coercions (default: false)

  // Parse options
  filterChainOfThought?: boolean; // Filter reasoning text (default: true)
  returnAllCandidates?: boolean; // Return all candidate parses (default: false)
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         parseResponse                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌───────────────────────────┐   │
│  │ 1. Filter CoT Text  │───▶│ 2. Extract JSON           │   │
│  │    (if detected)    │    │    - Markdown blocks      │   │
│  └─────────────────────┘    │    - Direct JSON          │   │
│                             │    - Fix malformed        │   │
│                             └───────────────────────────┘   │
│                                          │                  │
│                                          ▼                  │
│                             ┌───────────────────────────┐   │
│                             │ 3. Type Coercion          │   │
│                             │    - Union matching       │   │
│                             │    - Field validation     │   │
│                             │    - Default values       │   │
│                             └───────────────────────────┘   │
│                                          │                  │
│                                          ▼                  │
│                             ┌───────────────────────────┐   │
│                             │ 4. Return ParseResult     │   │
│                             │    with metadata          │   │
│                             └───────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Comparison with Original BAML

| Feature           | Original BAML (Rust) | This Migration (TS) |
| ----------------- | -------------------- | ------------------- |
| Schema Definition | BAML DSL             | TypeBox             |
| Prompt Rendering  | `ctx.output_format`  | `renderSchema()`    |
| JSON Extraction   | jsonish parser       | `extractJson()`     |
| Type Coercion     | Coercer IR           | `coerceValue()`     |
| Streaming         | Native               | Supported           |
| Partial Results   | Native               | Supported           |
| Error Reporting   | Detailed             | Detailed            |
| Performance       | Native Rust          | JavaScript          |

## Development

```bash
# Clone the repository
git clone https://github.com/aiamblichus/structalign.git
cd structalign

# Install dependencies
pnpm install

# Build
pnpm run build

# Run tests
pnpm test

# Run example
pnpm run example

# Lint and format
pnpm run check
pnpm run check:fix
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

MIT © [aiamblichus](https://github.com/aiamblichus)

## Acknowledgments

- Original BAML project by [BoundaryML](https://www.boundaryml.com)
- [TypeBox](https://github.com/sinclairzx81/typebox) for the excellent schema validation library
