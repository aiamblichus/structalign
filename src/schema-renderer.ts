/**
 * Schema Renderer - Converts TypeBox schemas to LLM prompt instructions
 *
 * This is the TypeScript equivalent of BAML's render_output_format.rs
 * It generates schema instructions that guide the LLM to output correctly
 * structured data.
 */

import Type, {
	type TArray,
	type TBoolean,
	type TEnum,
	type TInteger,
	type TLiteral,
	type TNumber,
	type TObject,
	type TProperties,
	type TRecord,
	type TRef,
	type TSchema,
	type TString,
	type TTuple,
	type TUnion,
} from "typebox";

export interface SchemaRenderOptions {
	/** Include field descriptions in output */
	includeDescriptions?: boolean;
	/** Indentation level for formatting */
	indent?: number;
	/** Maximum depth for nested structures */
	maxDepth?: number;
	/** Whether to allow partial outputs (for streaming) */
	allowPartials?: boolean;
}

const defaultOptions: SchemaRenderOptions = {
	includeDescriptions: true,
	indent: 2,
	maxDepth: 50,
	allowPartials: false,
};

type LooseSchema = TSchema & Record<string, unknown>;

function asLooseSchema(schema: TSchema): LooseSchema {
	return schema as LooseSchema;
}

function getSchemaRef(schema: TSchema): string | undefined {
	return asLooseSchema(schema).$ref as string | undefined;
}

function getSchemaAnyOf(schema: TSchema): TSchema[] | undefined {
	const anyOf = asLooseSchema(schema).anyOf;
	return Array.isArray(anyOf) ? (anyOf as TSchema[]) : undefined;
}

function getSchemaDescription(schema: TSchema): string | undefined {
	const description = asLooseSchema(schema).description;
	return typeof description === "string" ? description : undefined;
}

function getNumberConstraint(schema: TSchema, key: string): number | undefined {
	const value = asLooseSchema(schema)[key];
	return typeof value === "number" ? value : undefined;
}

function getStringConstraint(schema: TSchema, key: string): string | undefined {
	const value = asLooseSchema(schema)[key];
	return typeof value === "string" ? value : undefined;
}

function getSchemaConst(schema: TSchema): unknown {
	return asLooseSchema(schema).const;
}

function getSchemaEnum(schema: TSchema): unknown[] {
	const value = asLooseSchema(schema).enum;
	return Array.isArray(value) ? value : [];
}

function assertTypeBoxSchema(schema: unknown, context: string): asserts schema is TSchema {
	if (!Type.IsSchema(schema)) {
		throw new Error(`Expected TypeBox-built schema at ${context}`);
	}
}

/**
 * Render a TypeBox schema as prompt instructions
 */
export function renderSchema(schema: TSchema, options: SchemaRenderOptions = {}): string {
	assertTypeBoxSchema(schema, "<root>");
	const opts = { ...defaultOptions, ...options };
	const visited = new WeakSet<TSchema>();

	try {
		const rendered = renderSchemaInternal(schema, opts, 0, visited);
		return formatOutput(rendered, schema, opts);
	} finally {
		// Cleanup visited set
		visited.delete(schema);
	}
}

/**
 * Main schema rendering function
 */
function renderSchemaInternal(
	schema: TSchema,
	options: SchemaRenderOptions,
	depth: number,
	visited: WeakSet<TSchema>,
): string {
	assertTypeBoxSchema(schema, `depth:${depth}`);

	// Circular reference / max depth check
	if (depth > options.maxDepth! || visited.has(schema)) {
		return "<recursive>";
	}

	// Mark as visited for this render pass
	visited.add(schema);

	try {
		// Handle schema references
		const schemaRef = getSchemaRef(schema);
		if (Type.IsRef(schema) || schemaRef) {
			return `<reference to: ${schemaRef}>`;
		}

		// Handle different schema kinds
		if (Type.IsObject(schema)) {
			return renderObject(schema as TObject, options, depth, visited);
		}
		if (Type.IsArray(schema)) {
			return renderArray(schema as TArray, options, depth, visited);
		}
		if (Type.IsUnion(schema)) {
			return renderUnion(schema as TUnion, options, depth, visited);
		}
		if (Type.IsIntersect(schema)) {
			return renderIntersect(schema, options, depth, visited);
		}
		if (Type.IsLiteral(schema)) {
			return renderLiteral(schema as TLiteral);
		}
		if (Type.IsEnum(schema)) {
			return renderEnum(schema as TEnum);
		}
		if (Type.IsString(schema)) {
			return renderString(schema as TString);
		}
		if (Type.IsNumber(schema) || Type.IsInteger(schema)) {
			return renderNumber(schema as TNumber | TInteger);
		}
		if (Type.IsBoolean(schema)) {
			return renderBoolean(schema as TBoolean);
		}
		if (Type.IsNull(schema)) {
			return "null";
		}
		if (Type.IsAny(schema) || Type.IsUnknown(schema)) {
			return "any";
		}
		if (Type.IsRecord(schema)) {
			return renderRecord(schema as TRecord, options, depth, visited);
		}
		if (Type.IsTuple(schema)) {
			return renderTuple(schema as TTuple, options, depth, visited);
		}
		if (Type.IsRef(schema)) {
			return renderRef(schema as TRef);
		}

		throw new Error(`Unsupported TypeBox schema during rendering at depth ${depth}`);
	} finally {
		visited.delete(schema);
	}
}

function renderObject(schema: TObject, options: SchemaRenderOptions, depth: number, visited: WeakSet<TSchema>): string {
	const properties = schema.properties as TProperties;
	if (!properties || Object.keys(properties).length === 0) {
		return "{}";
	}

	const indent = " ".repeat(options.indent! * (depth + 1));
	const closeIndent = " ".repeat(options.indent! * depth);

	const fields = Object.entries(properties).map(([key, propSchema]) => {
		const isOptional = isOptionalProperty(propSchema);
		const typeStr = renderSchemaInternal(propSchema, options, depth + 1, visited);
		const descriptionText = getSchemaDescription(propSchema as TSchema);
		const description = options.includeDescriptions && descriptionText ? ` // ${descriptionText}` : "";

		return `${indent}"${key}": ${typeStr}${isOptional ? " (optional)" : ""}${description}`;
	});

	return `{\n${fields.join(",\n")}${closeIndent}\n${closeIndent}}`;
}

function renderArray(schema: TArray, options: SchemaRenderOptions, depth: number, visited: WeakSet<TSchema>): string {
	const items = schema.items as TSchema;
	if (!items) {
		return "any[]";
	}

	const itemStr = renderSchemaInternal(items, options, depth, visited);
	return `${itemStr}[]`;
}

function renderUnion(schema: TUnion, options: SchemaRenderOptions, depth: number, visited: WeakSet<TSchema>): string {
	const anyOf = (getSchemaAnyOf(schema) ?? []) as TSchema[];
	if (!anyOf || anyOf.length === 0) {
		return "any";
	}

	const variants = anyOf.map((s) => renderSchemaInternal(s, options, depth, visited));

	if (variants.length === 1) {
		return variants[0];
	}

	// For simple unions, use oneOf format
	if (variants.every((v) => !v.includes("\n"))) {
		return variants.join(" | ");
	}

	// For complex unions, use structured format
	const indent = " ".repeat(options.indent! * (depth + 1));
	return `one of:\n${variants.map((v, i) => `${indent}${i + 1}. ${v}`).join("\n")}`;
}

function renderIntersect(
	schema: TSchema,
	options: SchemaRenderOptions,
	depth: number,
	visited: WeakSet<TSchema>,
): string {
	const allOf = (schema as any).allOf as TSchema[];
	if (!allOf || allOf.length === 0) {
		return "{}";
	}

	// Merge all object schemas
	const merged: Record<string, TSchema> = {};
	for (const subSchema of allOf) {
		if (Type.IsObject(subSchema)) {
			const props = (subSchema as TObject).properties as TProperties;
			Object.assign(merged, props);
		}
	}

	// Create a merged object schema
	const mergedSchema = Type.Object(merged);

	return renderObject(mergedSchema, options, depth, visited);
}

function renderLiteral(schema: TLiteral): string {
	const value = getSchemaConst(schema);
	if (typeof value === "string") {
		return `"${value}"`;
	}
	return String(value);
}

function renderEnum(schema: TEnum): string {
	const values = getSchemaEnum(schema).filter(
		(v): v is string | number => typeof v === "string" || typeof v === "number",
	);
	if (!values || values.length === 0) {
		return "<empty enum>";
	}

	return values.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ");
}

function renderString(schema: TString): string {
	const constraints: string[] = [];
	const minLength = getNumberConstraint(schema, "minLength");
	const maxLength = getNumberConstraint(schema, "maxLength");
	const pattern = getStringConstraint(schema, "pattern");
	const format = getStringConstraint(schema, "format");

	if (minLength !== undefined) {
		constraints.push(`min ${minLength} chars`);
	}
	if (maxLength !== undefined) {
		constraints.push(`max ${maxLength} chars`);
	}
	if (pattern) {
		constraints.push(`matches /${pattern}/`);
	}
	if (format) {
		constraints.push(`format: ${format}`);
	}

	if (constraints.length > 0) {
		return `string (${constraints.join(", ")})`;
	}
	return "string";
}

function renderNumber(schema: TNumber | TInteger): string {
	const isInt = Type.IsInteger(schema);
	const typeName = isInt ? "integer" : "number";
	const constraints: string[] = [];
	const minimum = getNumberConstraint(schema, "minimum");
	const maximum = getNumberConstraint(schema, "maximum");
	const exclusiveMinimum = getNumberConstraint(schema, "exclusiveMinimum");
	const exclusiveMaximum = getNumberConstraint(schema, "exclusiveMaximum");
	const multipleOf = getNumberConstraint(schema, "multipleOf");

	if (minimum !== undefined) {
		constraints.push(`>= ${minimum}`);
	}
	if (maximum !== undefined) {
		constraints.push(`<= ${maximum}`);
	}
	if (exclusiveMinimum !== undefined) {
		constraints.push(`> ${exclusiveMinimum}`);
	}
	if (exclusiveMaximum !== undefined) {
		constraints.push(`< ${exclusiveMaximum}`);
	}
	if (multipleOf !== undefined) {
		constraints.push(`multiple of ${multipleOf}`);
	}

	if (constraints.length > 0) {
		return `${typeName} (${constraints.join(", ")})`;
	}
	return typeName;
}

function renderBoolean(_schema: TBoolean): string {
	return "boolean";
}

function renderRecord(schema: TRecord, options: SchemaRenderOptions, depth: number, visited: WeakSet<TSchema>): string {
	const pattern = (schema as any).patternProperties as Record<string, TSchema>;
	const additional = (schema as any).additionalProperties as TSchema;

	let valueType: string;
	if (pattern && Object.keys(pattern).length > 0) {
		const keyPattern = Object.keys(pattern)[0];
		valueType = renderSchemaInternal(pattern[keyPattern], options, depth, visited);
	} else if (additional) {
		valueType = renderSchemaInternal(additional, options, depth, visited);
	} else {
		valueType = "any";
	}

	return `Record<string, ${valueType}>`;
}

function renderTuple(schema: TTuple, options: SchemaRenderOptions, depth: number, visited: WeakSet<TSchema>): string {
	const items = schema.items as TSchema[];
	if (!items || items.length === 0) {
		return "[]";
	}

	const rendered = items.map((item) => renderSchemaInternal(item, options, depth, visited));
	return `[${rendered.join(", ")}]`;
}

function renderRef(schema: TRef): string {
	const ref = (schema as any).$ref as string;
	return ref ? `<${ref}>` : "<reference>";
}

function isOptionalProperty(schema: TSchema): boolean {
	// Check if it's an optional type
	if (Type.IsOptional(schema)) {
		return true;
	}

	// Check for nullable
	const variants = getSchemaAnyOf(schema);
	if (variants) {
		return variants.some((v) => Type.IsNull(v) || Type.IsUndefined(v));
	}

	return false;
}

/**
 * Format the final output with schema instructions
 */
function formatOutput(rendered: string, _schema: TSchema, options: SchemaRenderOptions): string {
	const lines: string[] = [];

	lines.push("Respond with a JSON object in the following format:");
	lines.push("");
	lines.push("```json");
	lines.push(rendered);
	lines.push("```");

	if (options.allowPartials) {
		lines.push("");
		lines.push("Note: If streaming, partial JSON is acceptable.");
	}

	return lines.join("\n");
}

/**
 * Create a prompt with schema instructions appended
 */
export function createPromptWithSchema(basePrompt: string, schema: TSchema, options?: SchemaRenderOptions): string {
	const schemaInstructions = renderSchema(schema, options);

	return `${basePrompt.trim()}\n\n${schemaInstructions}`;
}

/**
 * Create a compact JSON schema representation for the prompt
 * This is an alternative to the human-readable format above
 */
export function createJsonSchemaPrompt(
	basePrompt: string,
	schema: TSchema,
	_options: { includeExamples?: boolean } = {},
): string {
	const jsonSchema = JSON.stringify(schema, null, 2);

	let prompt = `${basePrompt.trim()}\n\nRespond with a JSON object matching this schema:\n\n`;
	prompt += "```json\n";
	prompt += jsonSchema;
	prompt += "\n```";

	return prompt;
}
