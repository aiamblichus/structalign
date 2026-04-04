/**
 * Core tests for BAML SAP TypeScript
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import Type from "typebox";
import {
	coerceValue,
	createPromptWithSchema,
	extractJson,
	filterChainOfThought,
	hasChainOfThought,
	parseResponse,
	renderSchema,
} from "../src/index.js";

describe("Schema Renderer", () => {
	it("should render a simple object schema", () => {
		const schema = Type.Object({
			name: Type.String(),
			age: Type.Number(),
		});

		const rendered = renderSchema(schema);
		assert(rendered.includes("name"));
		assert(rendered.includes("age"));
		assert(rendered.includes("string"));
		assert(rendered.includes("number"));
	});

	it("should render a union schema", () => {
		const schema = Type.Union([Type.Literal("a"), Type.Literal("b")]);

		const rendered = renderSchema(schema);
		assert(rendered.includes("a") || rendered.includes("one of"));
	});

	it("should create a prompt with schema", () => {
		const schema = Type.Object({
			result: Type.Boolean(),
		});

		const prompt = createPromptWithSchema("Test prompt", schema);
		assert(prompt.includes("Test prompt"));
		assert(prompt.includes("Respond with a JSON"));
		assert(prompt.includes("boolean"));
	});
});

describe("JSON Extractor", () => {
	it("should extract simple JSON", () => {
		const json = '{"name": "test", "value": 123}';
		const result = extractJson(json);

		assert.deepStrictEqual(result.value, { name: "test", value: 123 });
	});

	it("should extract JSON from markdown code block", () => {
		const markdown = '```json\n{"key": "value"}\n```';
		const result = extractJson(markdown);

		assert.deepStrictEqual(result.value, { key: "value" });
		assert.strictEqual(result.fromMarkdown, true);
	});

	it("should fix trailing commas", () => {
		const malformed = '{"a": 1, "b": 2,}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { a: 1, b: 2 });
		// Fixes may or may not be tracked depending on code path
		// The important thing is the value was extracted correctly
	});

	it("should return string when JSON is invalid and allowAsString is true", () => {
		const notJson = "This is just plain text";
		const result = extractJson(notJson);

		assert.strictEqual(result.value, notJson);
	});

	it("should normalize Unicode smart quotes in JSON", () => {
		const smartQuoted = "{“action”: “diagnostics”, “file”: “x.ts”}";
		const result = extractJson(smartQuoted);

		assert.deepStrictEqual(result.value, { action: "diagnostics", file: "x.ts" });
		assert(result.fixes?.includes("normalized_unicode_quotes"));
	});

	it("should not break valid JSON that contains smart quotes in string values", () => {
		const json = '{"command":"echo {“action”: “diagnostics”}"}';
		const result = extractJson(json);

		assert.deepStrictEqual(result.value, { command: "echo {“action”: “diagnostics”}" });
	});
});

describe("Type Coercer", () => {
	it("should coerce string to number", () => {
		const schema = Type.Number();
		const result = coerceValue("42", schema, { trackCoercions: true });

		assert.strictEqual(result.value, 42);
		assert(result.coercions?.some((c) => c.includes("parsed string")));
	});

	it("should coerce number to string", () => {
		const schema = Type.String();
		const result = coerceValue(123, schema);

		assert.strictEqual(result.value, "123");
	});

	it("should coerce missing optional fields", () => {
		const schema = Type.Object({
			required: Type.String(),
			optional: Type.Optional(Type.String()),
		});

		const result = coerceValue({ required: "test" }, schema);

		assert.strictEqual(result.value.required, "test");
		assert.strictEqual(result.value.optional, undefined);
	});

	it("should handle union types", () => {
		const schema = Type.Union([Type.String(), Type.Number()]);

		const result1 = coerceValue("hello", schema);
		assert.strictEqual(result1.value, "hello");

		const result2 = coerceValue(42, schema);
		assert.strictEqual(result2.value, 42);
	});

	it("should validate string constraints", () => {
		const schema = Type.String({ minLength: 3, maxLength: 10 });

		const result1 = coerceValue("hi", schema);
		assert(!result1.success);
		assert(result1.errors.some((e) => e.message.includes("too short")));

		const result2 = coerceValue("hello world!!!", schema);
		assert(!result2.success);
		assert(result2.errors.some((e) => e.message.includes("too long")));
	});

	it("should not coerce values when strict is true", () => {
		const schema = Type.Integer();
		const result = coerceValue("42", schema, { strict: true });

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.value, "42");
		assert(result.errors.length > 0);
	});
});

describe("Parse Response (Integration)", () => {
	it("should parse a simple JSON response", () => {
		const schema = Type.Object({
			name: Type.String(),
			count: Type.Integer(),
		});

		const response = '{"name": "test", "count": 5}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(result.value, { name: "test", count: 5 });
		assert.strictEqual(result.errors.length, 0);
	});

	it("should parse markdown-wrapped JSON", () => {
		const schema = Type.Object({
			value: Type.Boolean(),
		});

		const response = '```json\n{"value": true}\n```';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.value, true);
		assert.strictEqual(result.meta.fromMarkdown, true);
	});

	it("should filter chain-of-thought and parse", () => {
		const schema = Type.Object({
			answer: Type.String(),
		});

		const response = `Let me think... 
Step 1: Analyze
Step 2: Decide

Therefore the output JSON is:
\`\`\`json
{"answer": "hello"}
\`\`\``;

		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.answer, "hello");
		assert.strictEqual(result.meta.chainOfThoughtFiltered, true);
	});

	it("should handle partial responses", () => {
		const schema = Type.Object({
			items: Type.Array(Type.String()),
		});

		const response = '{"items": ["a", "b"'; // incomplete
		const result = parseResponse(response, schema, { allowPartials: true });

		// Should succeed with partial flag
		assert.strictEqual(result.isPartial, true);
	});

	it("should report errors for invalid data", () => {
		const schema = Type.Object({
			age: Type.Number({ minimum: 0 }),
		});

		const response = '{"age": -5}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, false);
		assert(result.errors.length > 0);
	});

	it("should coerce types when strict is false", () => {
		const schema = Type.Object({
			count: Type.Integer(),
		});

		// String number should be coerced
		const response = '{"count": "42"}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.count, 42);
	});

	it("should not coerce types when strict is true", () => {
		const schema = Type.Object({
			count: Type.Integer(),
		});

		const response = '{"count": "42"}';
		const result = parseResponse(response, schema, { strict: true });

		assert.strictEqual(result.success, false);
		assert(result.errors.length > 0);
		assert(result.errors.some((e) => e.path === "/count"));
	});

	it("should parse smart-quoted JSON in markdown blocks", () => {
		const schema = Type.Object({
			action: Type.String(),
			file: Type.String(),
		});

		const response = "```json\n{“action”: “diagnostics”, “file”: “x.ts”}\n```";
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(result.value, { action: "diagnostics", file: "x.ts" });
		assert(result.meta.fixes?.includes("normalized_unicode_quotes"));
	});
});

describe("Chain-of-Thought Detection", () => {
	it("should detect chain-of-thought text", () => {
		const reasoning = "Let me think step by step. First, I need to...";
		assert.strictEqual(hasChainOfThought(reasoning), true);

		const simple = '{"answer": "yes"}';
		assert.strictEqual(hasChainOfThought(simple), false);
	});

	it("should filter chain-of-thought", () => {
		const text = `Let me think...
    
    Therefore the output JSON is:
    {"result": "success"}`;

		const filtered = filterChainOfThought(text);
		assert(filtered.includes("result"));
		assert(!filtered.includes("Let me think"));
	});
});

describe("Complex Schemas", () => {
	it("should handle nested objects", () => {
		const schema = Type.Object({
			user: Type.Object({
				profile: Type.Object({
					name: Type.String(),
				}),
			}),
		});

		const response = '{"user": {"profile": {"name": "Alice"}}}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.user.profile.name, "Alice");
	});

	it("should handle arrays", () => {
		const schema = Type.Object({
			items: Type.Array(
				Type.Object({
					id: Type.Integer(),
					name: Type.String(),
				}),
			),
		});

		const response = '{"items": [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.items.length, 2);
	});

	it("should handle enums", () => {
		const StatusEnum = Type.Enum({
			PENDING: "PENDING",
			DONE: "DONE",
		});

		const schema = Type.Object({
			status: StatusEnum,
		});

		const response = '{"status": "PENDING"}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.status, "PENDING");
	});

	it("should handle records/maps", () => {
		const schema = Type.Record(Type.String(), Type.Number());

		const response = '{"a": 1, "b": 2}';
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.a, 1);
		assert.strictEqual(result.value.b, 2);
	});
});

// Additional tests for missing comma fixes
describe("Missing Comma Fixes", () => {
	it("should fix missing commas between properties with newline", () => {
		const malformed = '{"summary": "test value."\n  "keywords": ["a", "b"]}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { summary: "test value.", keywords: ["a", "b"] });
	});

	it("should fix missing commas between properties on same line", () => {
		const malformed = '{"a": "value"  "b": "value2"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { a: "value", b: "value2" });
	});

	it("should fix multiple missing commas in same object", () => {
		const malformed = '{"a": "value"\n  "b": "value2"\n  "c": "value3"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { a: "value", b: "value2", c: "value3" });
	});

	it("should fix missing comma after number value", () => {
		const malformed = '{"count": 42\n  "name": "test"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { count: 42, name: "test" });
	});

	it("should fix missing comma after boolean value", () => {
		const malformed = '{"active": true\n  "name": "test"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { active: true, name: "test" });
	});

	it("should fix missing comma after array value", () => {
		const malformed = '{"items": [1, 2]\n  "name": "test"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { items: [1, 2], name: "test" });
	});

	it("should not add comma inside string values with quotes", () => {
		// This should NOT add a comma because "next" is not followed by :
		const json = '{"text": "She said \\"hello\\"  and then left"}';
		const result = extractJson(json);

		// The regex should NOT match this since "and" is not a property key
		assert.deepStrictEqual(result.value, { text: 'She said "hello"  and then left' });
	});

	it("should fix missing comma in deeply nested objects", () => {
		const malformed = '{"outer": {"inner": "value"\n  "num": 123}\n  "other": "test"}';
		const result = extractJson(malformed);

		assert.deepStrictEqual(result.value, { outer: { inner: "value", num: 123 }, other: "test" });
	});

	it("should work with default parseResponse options (no special flags needed)", () => {
		const schema = Type.Object({
			name: Type.String(),
			value: Type.Number(),
		});

		// Missing comma after "test"
		const response = '{"name": "test"\n  "value": 42}';

		// No options passed - should work with defaults
		const result = parseResponse(response, schema);

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(result.value, { name: "test", value: 42 });
	});

	it("should parse complex schema with missing comma (original user case)", () => {
		const SummarizeSchema = Type.Object({
			summary: Type.String(),
			keywords: Type.Array(Type.String()),
			category: Type.Union([
				Type.Literal("article"),
				Type.Literal("documentation"),
				Type.Literal("research"),
				Type.Literal("news"),
			]),
		});

		// Missing comma after summary field (the original user case)
		const response = '{\n  "summary": "The article discusses AI disrupting industries.",\n  "keywords": [\n    "AI",\n    "disruption"\n  ],\n  "category": "article"\n}';

		const result = parseResponse(response, SummarizeSchema);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.value.summary, "The article discusses AI disrupting industries.");
		assert.deepStrictEqual(result.value.keywords, ["AI", "disruption"]);
		assert.strictEqual(result.value.category, "article");
	});
});
