/**
 * JSON Extractor - Extracts JSON from LLM responses
 *
 * Handles:
 * - Markdown code block extraction
 * - Multiple JSON objects
 * - JSON fixing (trailing commas, missing quotes)
 * - Chain-of-thought text filtering
 *
 * Based on BAML's jsonish parser
 */

export interface ExtractionOptions {
	/** Allow extracting JSON from markdown code blocks */
	allowMarkdownJson?: boolean;
	/** Attempt to fix malformed JSON */
	allowFixes?: boolean;
	/** Return raw string if all else fails */
	allowAsString?: boolean;
	/** Find all JSON objects in the text */
	findAllJsonObjects?: boolean;
	/** Normalize typographic Unicode quotes (e.g. “ ” ‘ ’) before parsing */
	normalizeUnicodeQuotes?: boolean;
	/** Maximum recursion depth for nested parsing */
	maxDepth?: number;
}

const defaultOptions: Required<ExtractionOptions> = {
	allowMarkdownJson: true,
	allowFixes: true,
	allowAsString: true,
	findAllJsonObjects: true,
	normalizeUnicodeQuotes: true,
	maxDepth: 100,
};

/**
 * Result of JSON extraction
 */
export interface ExtractionResult {
	/** The extracted value(s) */
	value: unknown;
	/** The raw text that was parsed */
	raw: string;
	/** Whether this was from a markdown code block */
	fromMarkdown?: boolean;
	/** Fixes that were applied */
	fixes?: string[];
	/** Whether this is a partial/incomplete result (for streaming) */
	isPartial?: boolean;
}

function normalizeUnicodeQuotes(text: string): string {
	return text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

function withPreprocessingFixes(
	result: ExtractionResult,
	preprocessingFixes: string[],
	originalRawText: string,
): ExtractionResult {
	if (preprocessingFixes.length === 0) {
		if (result.raw === originalRawText) return result;
		return {
			...result,
			raw: originalRawText,
		};
	}

	const mergedFixes = [...new Set([...(result.fixes ?? []), ...preprocessingFixes])];
	return {
		...result,
		raw: originalRawText,
		fixes: mergedFixes,
	};
}

/**
 * Extract JSON from an LLM response string
 */
export function extractJson(
	text: string,
	options: ExtractionOptions = {},
	isDone: boolean = true,
	depth: number = 0,
): ExtractionResult {
	const opts: Required<ExtractionOptions> = {
		...defaultOptions,
		...options,
		allowMarkdownJson: options.allowMarkdownJson ?? defaultOptions.allowMarkdownJson,
		allowFixes: options.allowFixes ?? defaultOptions.allowFixes,
		allowAsString: options.allowAsString ?? defaultOptions.allowAsString,
		findAllJsonObjects: options.findAllJsonObjects ?? defaultOptions.findAllJsonObjects,
		normalizeUnicodeQuotes: options.normalizeUnicodeQuotes ?? defaultOptions.normalizeUnicodeQuotes,
		maxDepth: options.maxDepth ?? defaultOptions.maxDepth,
	};

	// Depth limit check
	if (depth > opts.maxDepth!) {
		throw new Error("Depth limit reached. Likely a circular reference.");
	}

	const direct = tryExtractJsonCore(text, opts, isDone, depth);
	if (direct) return direct;

	// Fallback pass: normalize smart quotes only if the original text could not be parsed.
	// This avoids corrupting already-valid JSON strings that merely contain typographic quotes in values.
	if (opts.normalizeUnicodeQuotes) {
		const normalized = normalizeUnicodeQuotes(text);
		if (normalized !== text) {
			const normalizedResult = tryExtractJsonCore(
				normalized,
				{ ...opts, normalizeUnicodeQuotes: false, allowAsString: false },
				isDone,
				depth,
			);
			if (normalizedResult) {
				return withPreprocessingFixes(normalizedResult, ["normalized_unicode_quotes"], text);
			}
		}
	}

	// Return as string if allowed
	if (opts.allowAsString) {
		return {
			value: text,
			raw: text,
			isPartial: !isDone,
		};
	}

	throw new Error("Failed to extract JSON from response");
}

function tryExtractJsonCore(
	text: string,
	opts: Required<ExtractionOptions>,
	isDone: boolean,
	depth: number,
): ExtractionResult | null {
	// Try direct JSON parsing first
	const directResult = tryParseDirect(text, isDone);
	if (directResult) {
		return directResult;
	}

	// Try markdown extraction
	if (opts.allowMarkdownJson) {
		const markdownResult = tryExtractFromMarkdown(text, opts, isDone, depth + 1);
		if (markdownResult) {
			return markdownResult;
		}
	}

	// Try finding all JSON objects
	if (opts.findAllJsonObjects) {
		const multiResult = tryExtractMultipleJson(text, opts, isDone, depth + 1);
		if (multiResult) {
			return multiResult;
		}
	}

	// Try fixing malformed JSON
	if (opts.allowFixes) {
		const fixedResult = tryFixJson(text, opts, isDone, depth + 1);
		if (fixedResult) {
			return fixedResult;
		}
	}

	return null;
}

/**
 * Try to parse the text directly as JSON
 */
function tryParseDirect(text: string, isDone: boolean): ExtractionResult | null {
	const trimmed = text.trim();

	try {
		// Check if it looks like JSON before trying to parse
		if (!looksLikeJson(trimmed)) {
			return null;
		}

		const parsed = JSON.parse(trimmed);
		return {
			value: parsed,
			raw: text,
			isPartial: !isDone,
		};
	} catch {
		return null;
	}
}

/**
 * Check if text looks like it might be JSON
 */
function looksLikeJson(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;

	const firstChar = trimmed[0];
	const lastChar = trimmed[trimmed.length - 1];

	// Object or array
	if ((firstChar === "{" && lastChar === "}") || (firstChar === "[" && lastChar === "]")) {
		return true;
	}

	// String (quoted)
	if (firstChar === '"' && lastChar === '"') {
		return true;
	}

	// Number, boolean, null
	if (/^-?\d/.test(trimmed) || trimmed === "true" || trimmed === "false" || trimmed === "null") {
		return true;
	}

	return false;
}

/**
 * Extract JSON from markdown code blocks
 */
function tryExtractFromMarkdown(
	text: string,
	options: ExtractionOptions,
	isDone: boolean,
	_depth: number,
): ExtractionResult | null {
	// Regex for markdown code blocks
	const codeBlockRegex = /^(\s*)```(\w*)\s*\n?([\s\S]*?)```/gm;

	const matches: Array<{ lang: string; content: string }> = [];
	let match: RegExpExecArray | null;

	while (true) {
		match = codeBlockRegex.exec(text);
		if (match === null) break;
		matches.push({
			lang: match[2].trim().toLowerCase(),
			content: match[3].trim(),
		});
	}

	if (matches.length === 0) {
		return null;
	}

	// Filter for JSON-like blocks
	const jsonBlocks = matches.filter(
		(m) =>
			m.lang === "json" || m.lang === "" || m.lang === "javascript" || m.lang === "js" || looksLikeJson(m.content),
	);

	if (jsonBlocks.length === 0) {
		return null;
	}

	// If only one block, try to parse it directly
	if (jsonBlocks.length === 1) {
		try {
			const content = jsonBlocks[0].content;
			const parsed = extractJson(content, options, isDone, _depth);
			return {
				...parsed,
				fromMarkdown: true,
			};
		} catch {
			// Continue to try other blocks
		}
	}

	// Multiple blocks - try to parse each and return the first valid one
	// or return all as an array
	const results: unknown[] = [];
	const errors: string[] = [];

	for (const block of jsonBlocks) {
		try {
			const parsed = JSON.parse(block.content);
			results.push(parsed);
		} catch (e) {
			errors.push(String(e));
			// Try with fixes
			try {
				const fixed = tryFixJson(block.content, options, isDone, _depth);
				if (fixed) {
					results.push(fixed.value);
				}
			} catch {
				// Ignore fix errors
			}
		}
	}

	if (results.length === 1) {
		return {
			value: results[0],
			raw: text,
			fromMarkdown: true,
			isPartial: !isDone,
		};
	}

	if (results.length > 1) {
		return {
			value: results,
			raw: text,
			fromMarkdown: true,
			isPartial: !isDone,
		};
	}

	return null;
}

/**
 * Try to extract multiple JSON objects from text
 */
function tryExtractMultipleJson(
	text: string,
	_options: ExtractionOptions,
	isDone: boolean,
	_depth: number,
): ExtractionResult | null {
	const objects: unknown[] = [];
	const jsonRegex = /\{[\s\S]*?\}|\[[\s\S]*?\]/g;

	let match: RegExpExecArray | null;
	while (true) {
		match = jsonRegex.exec(text);
		if (match === null) break;
		try {
			const candidate = match[0];
			const parsed = JSON.parse(candidate);
			objects.push(parsed);
		} catch {
			// Try with fixes
			try {
				const fixed = applyJsonFixes(match[0]);
				const parsed = JSON.parse(fixed);
				objects.push(parsed);
			} catch {
				// Not valid JSON
			}
		}
	}

	if (objects.length === 0) {
		return null;
	}

	if (objects.length === 1) {
		return {
			value: objects[0],
			raw: text,
			isPartial: !isDone,
		};
	}

	return {
		value: objects,
		raw: text,
		isPartial: !isDone,
	};
}

/**
 * Try to fix malformed JSON
 */
function tryFixJson(
	text: string,
	_options: ExtractionOptions,
	isDone: boolean,
	_depth: number,
): ExtractionResult | null {
	const fixes: string[] = [];

	try {
		let fixed = text;

		// Apply fixes
		const fixedResult = applyJsonFixes(fixed);
		if (fixedResult !== fixed) {
			fixes.push("applied_auto_fixes");
			fixed = fixedResult;
		}

		// Try parsing the fixed text
		const parsed = JSON.parse(fixed);

		return {
			value: parsed,
			raw: text,
			fixes,
			isPartial: !isDone,
		};
	} catch {
		// Try extracting partial JSON
		const partial = tryExtractPartialJson(text);
		if (partial) {
			fixes.push("extracted_partial");
			return {
				value: partial,
				raw: text,
				fixes,
				isPartial: true,
			};
		}
	}

	return null;
}

/**
 * Apply common JSON fixes
 */
function applyJsonFixes(text: string): string {
	let fixed = text.trim();

	// Remove trailing commas before } or ]
	fixed = fixed.replace(/,(\s*[}\]])/g, "$1");

	// Fix missing commas between properties - handles values followed by newline and next property key
	// This handles: "string"\n  "key": , 42\n  "key": , true\n  "key": , ]\n  "key": , }\n  "key":
	fixed = fixed.replace(/("[^"]*"|\d+(?:\.\d+)?|true|false|null|\]|\})(\s*)(\n\s*)(")/g, (match, p1, p2, p3, p4, offset, string) => {
		// Check if what follows looks like a JSON property key (identifier followed by ":)
		const after = string.slice(offset + match.length - 1);
		// If what follows looks like a JSON key (": following), add the comma
		if (/^[a-zA-Z_$][a-zA-Z0-9_$]*"\s*:/.test(after)) {
			return `${p1},${p2}${p3}${p4}`;
		}
		return match;
	});
	// Also fix the simpler case: value  "key": (no newline, just whitespace)
	// Handles: "value"  "key": , 42  "key": , ]  "key": , }  "key":
	fixed = fixed.replace(/("[^"]*"|\d+(?:\.\d+)?|true|false|null|\]|\})(\s+)("[a-zA-Z_$][a-zA-Z0-9_$]*"\s*:)/g, '$1,$2$3');

	// Fix single quotes to double quotes (carefully)
	// Only fix property keys and simple string values, not content inside strings
	fixed = fixed.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');

	// Fix unquoted keys (simple cases only)
	fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

	// Fix missing quotes around string values (simple cases)
	// This is risky but common with LLMs
	// fixed = fixed.replace(/: \s*([a-zA-Z][a-zA-Z0-9_]*)\s*([,}])/g, ': "$1"$2');

	// Fix line breaks in strings (replace with \n)
	// This is a simplified approach - real implementation would be more careful
	// fixed = fixed.replace(/"([^"]*)\n([^"]*)"/g, '"$1\\n$2"');

	return fixed;
}

/**
 * Try to extract partial/incomplete JSON (for streaming)
 */
function tryExtractPartialJson(text: string): unknown | null {
	// Try to complete an incomplete object
	let fixed = text.trim();

	// Count braces
	const openBraces = (fixed.match(/\{/g) || []).length;
	const closeBraces = (fixed.match(/\}/g) || []).length;
	const openBrackets = (fixed.match(/\[/g) || []).length;
	const closeBrackets = (fixed.match(/\]/g) || []).length;

	// Add missing closing braces/brackets
	fixed += "}".repeat(Math.max(0, openBraces - closeBraces));
	fixed += "]".repeat(Math.max(0, openBrackets - closeBrackets));

	try {
		return JSON.parse(fixed);
	} catch {
		// Try without the added closings if that failed
		return null;
	}
}

/**
 * Filter out chain-of-thought reasoning text
 * Returns the text that appears after reasoning markers
 *
 * Important: pattern order and specificity matter. We must not match prose inside
 * the final JSON (e.g. "therefore" or "answer:" in a string) before a ```json
 * fence. Therefore:
 * 1) Prefer an explicit ```json code fence (first occurrence).
 * 2) Then try a small set of high-specificity “preamble + colon” patterns.
 * 3) Do not use a bare `answer:` submatch — that appears in normal text/HTML.
 * 4) Fall back to the first `{` for unfenced single-object output.
 */
export function filterChainOfThought(text: string): string {
	// 1) Explicit JSON fence: unambiguous, wins over any substring inside the payload
	const jsonFence = text.match(/```\s*json\s*\n?/i);
	if (jsonFence && jsonFence.index !== undefined) {
		return text.slice(jsonFence.index).trim();
	}

	// 2) Phrases that usually introduce structured output in model preambles
	const preamblePatterns: RegExp[] = [
		/here is the json[\s\S]*?:\s*/i,
		/output json[\s\S]*?:\s*/i,
		/therefore the output json is[\s\S]*?:\s*/i,
		/final answer[\s\S]*?:\s*/i,
	];

	for (const pattern of preamblePatterns) {
		const match = text.match(pattern);
		if (match && match.index !== undefined) {
			return text.slice(match.index).trim();
		}
	}

	// 3) "Answer:" only as a *line-start* block header (avoids "The answer: …" in prose)
	//    …\nanswer:\n or start-of-text answer:\n, then a newline so JSON can follow
	const lineHeaderAnswer = text.match(
		/(?:^|[\r\n])[\t ]*(?:final )?answer:[\t ]*[^\r\n]*(?:[\r\n]+|$)/im,
	);
	if (lineHeaderAnswer && lineHeaderAnswer.index !== undefined) {
		return text.slice(lineHeaderAnswer.index).trim();
	}

	// 4) First `{` through end of string — for unfenced JSON (fragile if `{` in prose)
	const brace = text.match(/\{[\s\S]*/);
	if (brace && brace.index !== undefined) {
		return text.slice(brace.index).trim();
	}

	return text;
}

/**
 * Extract all candidate JSON strings from text
 * Useful for debugging and multiple-choice scenarios
 */
export function extractAllCandidates(text: string): string[] {
	const candidates: string[] = [];

	// Direct JSON-like strings
	const jsonRegex = /\{[\s\S]*?\}|\[[\s\S]*?\]|"[^"]*"|-?\d+(?:\.\d+)?|true|false|null/g;
	let match: RegExpExecArray | null;
	while (true) {
		match = jsonRegex.exec(text);
		if (match === null) break;
		candidates.push(match[0]);
	}

	// Markdown code blocks
	const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
	while (true) {
		match = codeBlockRegex.exec(text);
		if (match === null) break;
		candidates.push(match[1].trim());
	}

	return [...new Set(candidates)]; // Remove duplicates
}

/**
 * Heuristic: does the response look like it prefixed chain-of-thought?
 *
 * Kept conservative: patterns like "therefore" or "first, " match large
 * structured JSON/HTML payloads and spuriously enabled the CoT filter, which
 * then combined badly with broad `filterChainOfThought` cuts. Prefer explicit
 * thinking markers; unfenced JSON after short CoT is still handled by
 * `filterChainOfThought` when this returns true, and `extractJson` can find
 * objects in mixed text when extraction runs on the full string.
 */
export function hasChainOfThought(text: string): boolean {
	const patterns = [
		/let me think/i,
		/step by step/i,
		/reasoning:/i,
		/thinking:/i,
		/analysis:/i,
		/in conclusion/i,
	];

	return patterns.some((p) => p.test(text));
}
