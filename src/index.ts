/**
 * BAML SAP TypeScript Migration
 *
 * Schema-Aligned Parsing (SAP) for TypeScript using TypeBox
 *
 * This is a TypeScript port of BAML's core algorithm for structured
 * data extraction from LLM responses.
 *
 * Usage:
 * ```typescript
 * import { Type } from '@sinclair/typebox';
 * import { createPromptWithSchema, parseResponse } from 'structalign';
 *
 * const schema = Type.Object({
 *   name: Type.String(),
 *   age: Type.Number(),
 * });
 *
 * // Create a prompt with schema instructions
 * const prompt = createPromptWithSchema(
 *   'Extract user information from: John is 25 years old',
 *   schema
 * );
 *
 * // After getting LLM response, parse it
 * const response = `{ "name": "John", "age": 25 }`;
 * const result = parseResponse(response, schema);
 *
 * if (result.success) {
 *   console.log(result.value); // { name: "John", age: 25 }
 * }
 * ```
 */

import type { Static, TSchema } from "@sinclair/typebox";
import {
	type ExtractionOptions,
	type ExtractionResult,
	extractJson,
	filterChainOfThought,
	hasChainOfThought,
} from "./json-extractor.js";
import {
	createJsonSchemaPrompt,
	createPromptWithSchema as createPrompt,
	renderSchema,
	type SchemaRenderOptions,
} from "./schema-renderer.js";
import { type CoercionOptions, type CoercionResult, coerceValue, validateValue } from "./type-coercer.js";

export {
	extractAllCandidates,
	extractJson,
	filterChainOfThought,
	hasChainOfThought,
} from "./json-extractor.js";
// Re-export types and functions
export { createJsonSchemaPrompt, renderSchema } from "./schema-renderer.js";
export {
	type CoercionError,
	type CoercionOptions,
	type CoercionResult,
	coerceValue,
	validateValue,
} from "./type-coercer.js";
export type { SchemaRenderOptions, ExtractionOptions };

/**
 * Main options for parseResponse
 */
export interface ParseOptions extends ExtractionOptions, CoercionOptions {
	/** Filter out chain-of-thought reasoning before parsing */
	filterChainOfThought?: boolean;
	/** Return all candidate parses (useful for debugging) */
	returnAllCandidates?: boolean;
}

const defaultParseOptions: ParseOptions = {
	// Extraction defaults
	allowMarkdownJson: true,
	allowFixes: true,
	allowAsString: true,
	findAllJsonObjects: true,
	maxDepth: 100,
	// Coercion defaults
	allowPartials: false,
	useDefaults: true,
	strict: false,
	trackCoercions: false,
	// Parse defaults
	filterChainOfThought: true,
	returnAllCandidates: false,
};

/**
 * Result from parsing an LLM response
 */
export interface ParseResult<T = unknown> {
	/** Whether parsing was successful */
	success: boolean;
	/** The parsed and validated value */
	value: T;
	/** Errors encountered during parsing */
	errors: Array<{ path: string; message: string }>;
	/** Whether the result is partial (for streaming) */
	isPartial: boolean;
	/** Metadata about the parsing process */
	meta: {
		/** Raw text that was parsed */
		raw: string;
		/** Whether text was extracted from markdown */
		fromMarkdown?: boolean;
		/** Whether chain-of-thought was detected and filtered */
		chainOfThoughtFiltered?: boolean;
		/** Fixes applied during JSON extraction */
		fixes?: string[];
		/** Coercions applied during type validation */
		coercions?: string[];
	};
}

/**
 * Parse an LLM response into a typed value
 *
 * This is the main entry point for the SAP algorithm.
 * It handles:
 * 1. Chain-of-thought filtering
 * 2. JSON extraction from markdown/text
 * 3. Type coercion and validation
 *
 * @param response - The raw LLM response text
 * @param schema - TypeBox schema to validate against
 * @param options - Parsing options
 * @returns ParseResult with the typed value or errors
 */
export function parseResponse<T extends TSchema>(
	response: string,
	schema: T,
	options: ParseOptions = {},
): ParseResult<Static<T>> {
	const opts = { ...defaultParseOptions, ...options };

	// Step 1: Filter chain-of-thought if needed
	let text = response;
	let chainOfThoughtFiltered = false;

	if (opts.filterChainOfThought && hasChainOfThought(response)) {
		text = filterChainOfThought(response);
		chainOfThoughtFiltered = text !== response;
	}

	// Step 2: Extract JSON
	let extraction: ExtractionResult;
	try {
		extraction = extractJson(text, opts, true, 0);
	} catch (error) {
		return {
			success: false,
			value: undefined as unknown as Static<T>,
			errors: [
				{
					path: "",
					message: `JSON extraction failed: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isPartial: false,
			meta: {
				raw: response,
				chainOfThoughtFiltered,
			},
		};
	}

	// Step 3: Coerce to schema
	const coercion = coerceValue(extraction.value, schema, opts);

	return {
		success: coercion.success,
		value: coercion.value,
		errors: coercion.errors.map((e) => ({ path: e.path, message: e.message })),
		isPartial: coercion.isPartial || false,
		meta: {
			raw: response,
			fromMarkdown: extraction.fromMarkdown,
			chainOfThoughtFiltered,
			fixes: extraction.fixes,
			coercions: coercion.coercions,
		},
	};
}

/**
 * Stream parser for handling partial LLM responses
 *
 * This is useful for streaming scenarios where you want to
 * show partial results as they arrive.
 *
 * @param partialResponse - The partial response text so far
 * @param schema - TypeBox schema to validate against
 * @param options - Parsing options
 * @returns ParseResult with the best-effort typed value
 */
export function parsePartialResponse<T extends TSchema>(
	partialResponse: string,
	schema: T,
	options: ParseOptions = {},
): ParseResult<Static<T>> {
	const opts = {
		...defaultParseOptions,
		...options,
		allowPartials: true,
		allowAsString: true,
	};

	return parseResponse(partialResponse, schema, opts);
}

/**
 * Create a prompt with schema instructions
 *
 * Appends schema instructions to a base prompt to guide
 * the LLM toward producing correctly structured output.
 *
 * @param basePrompt - The base prompt text
 * @param schema - TypeBox schema describing expected output
 * @param options - Schema rendering options
 * @returns Complete prompt with schema instructions
 */
export function createPromptWithSchema(basePrompt: string, schema: TSchema, options?: SchemaRenderOptions): string {
	return createPrompt(basePrompt, schema, options);
}

/**
 * Parse multiple candidates from a response
 *
 * Useful when the LLM might have provided multiple JSON objects
 * and you want to try them all.
 *
 * @param response - The raw LLM response text
 * @param schema - TypeBox schema to validate against
 * @param options - Parsing options
 * @returns Array of ParseResults for each candidate
 */
export function parseAllCandidates<T extends TSchema>(
	response: string,
	schema: T,
	options: ParseOptions = {},
): ParseResult<Static<T>>[] {
	const { extractAllCandidates } = require("./json-extractor.js");
	const candidates = extractAllCandidates(response);

	const results: ParseResult<Static<T>>[] = [];

	for (const candidate of candidates) {
		try {
			const result = parseResponse(candidate, schema, options);
			results.push(result);
		} catch {
			// Skip invalid candidates
		}
	}

	return results;
}

/**
 * Get the best candidate from multiple options
 *
 * Returns the candidate with the fewest errors.
 *
 * @param response - The raw LLM response text
 * @param schema - TypeBox schema to validate against
 * @param options - Parsing options
 * @returns The best ParseResult or null if none valid
 */
export function parseBestCandidate<T extends TSchema>(
	response: string,
	schema: T,
	options: ParseOptions = {},
): ParseResult<Static<T>> | null {
	const candidates = parseAllCandidates(response, schema, options);

	if (candidates.length === 0) {
		return null;
	}

	// Sort by number of errors (ascending)
	candidates.sort((a, b) => a.errors.length - b.errors.length);

	return candidates[0];
}

/**
 * Check if a response is valid against a schema without full parsing
 *
 * @param response - The raw LLM response text
 * @param schema - TypeBox schema to validate against
 * @returns Whether the response is valid
 */
export function isValidResponse(response: string, schema: TSchema): boolean {
	try {
		const result = parseResponse(response, schema);
		return result.success;
	} catch {
		return false;
	}
}

/**
 * Debug helper to see what the parser is doing
 *
 * @param response - The raw LLM response text
 * @param schema - TypeBox schema to validate against
 * @returns Debug information
 */
export function debugParse(
	response: string,
	schema: TSchema,
): {
	filteredText: string;
	extractedValue: unknown;
	extractionErrors: string[];
	coercionResult: CoercionResult<unknown>;
} {
	const filteredText = hasChainOfThought(response) ? filterChainOfThought(response) : response;

	let extractedValue: unknown = null;
	const extractionErrors: string[] = [];

	try {
		const extraction = extractJson(filteredText, {}, true, 0);
		extractedValue = extraction.value;
	} catch (error) {
		extractionErrors.push(String(error));
	}

	const coercionResult = coerceValue(extractedValue ?? filteredText, schema, { trackCoercions: true });

	return {
		filteredText,
		extractedValue,
		extractionErrors,
		coercionResult,
	};
}

// Default export
export default {
	parseResponse,
	parsePartialResponse,
	createPromptWithSchema,
	parseAllCandidates,
	parseBestCandidate,
	isValidResponse,
	debugParse,
	renderSchema,
	createJsonSchemaPrompt,
	extractJson,
	filterChainOfThought,
	hasChainOfThought,
	coerceValue,
	validateValue,
};
