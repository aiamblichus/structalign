/**
 * Type Coercer - Validates and coerces parsed data to TypeBox schemas
 *
 * This module takes extracted JSON and validates/coerces it against
 * TypeBox schemas, handling:
 * - Union type matching
 * - Optional fields
 * - Default values
 * - Type conversions
 * - Array/object coercion
 *
 * Based on BAML's deserializer/coercer
 */

import Type, {
	type Static,
	type TArray,
	type TEnum,
	type TInteger,
	type TLiteral,
	type TNumber,
	type TObject,
	type TProperties,
	type TRecord,
	type TSchema,
	type TString,
	type TTuple,
	type TUnion,
} from "typebox";
import Value from "typebox/value";

export interface CoercionOptions {
	/** Allow partial objects (for streaming) */
	allowPartials?: boolean;
	/** Use default values for missing fields */
	useDefaults?: boolean;
	/** Strict mode - no type coercion */
	strict?: boolean;
	/** Maximum depth for coercion */
	maxDepth?: number;
	/** Track applied coercions */
	trackCoercions?: boolean;
}

const defaultOptions: CoercionOptions = {
	allowPartials: false,
	useDefaults: true,
	strict: false,
	maxDepth: 50,
	trackCoercions: false,
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

function getSchemaDefault(schema: TSchema): unknown {
	return asLooseSchema(schema).default;
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
 * Result of type coercion
 */
export interface CoercionResult<T = unknown> {
	/** The coerced value */
	value: T;
	/** Whether the coercion was successful */
	success: boolean;
	/** Errors encountered during coercion */
	errors: CoercionError[];
	/** Coercions that were applied */
	coercions?: string[];
	/** Whether this is a partial result */
	isPartial?: boolean;
}

export interface CoercionError {
	path: string;
	message: string;
	expected?: string;
	received?: string;
}

/**
 * Coerce a value to match a TypeBox schema
 */
export function coerceValue<T extends TSchema>(
	value: unknown,
	schema: T,
	options: CoercionOptions = {},
	path: string = "",
): CoercionResult<Static<T>> {
	assertTypeBoxSchema(schema, path || "<root>");
	const opts = { ...defaultOptions, ...options };
	const errors: CoercionError[] = [];
	const coercions: string[] = [];

	function addCoercion(message: string) {
		if (opts.trackCoercions) {
			coercions.push(message);
		}
	}

	function addError(message: string, expected?: string, received?: string) {
		errors.push({
			path,
			message,
			expected,
			received: received ?? String(value),
		});
	}

	if (opts.strict) {
		const validation = validateValue(value, schema);
		return {
			value: value as Static<T>,
			success: validation.valid,
			errors: validation.errors,
			coercions: opts.trackCoercions ? [] : undefined,
			isPartial: opts.allowPartials && !isComplete(value, schema),
		};
	}

	const result = coerceInternal(value, schema, opts, path, 0, addCoercion, addError);

	return {
		value: result as Static<T>,
		success: errors.length === 0,
		errors,
		coercions: opts.trackCoercions ? coercions : undefined,
		isPartial: opts.allowPartials && !isComplete(value, schema),
	};
}

/**
 * Internal coercion function
 */
function coerceInternal(
	value: unknown,
	schema: TSchema,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	assertTypeBoxSchema(schema, path || "<root>");

	// Depth limit
	if (depth > options.maxDepth!) {
		addError("Maximum depth exceeded");
		return value;
	}

	// Handle null/undefined
	if (value === null || value === undefined) {
		return coerceNull(value, schema, options, path, addCoercion, addError);
	}

	// Handle schema references
	const schemaRef = getSchemaRef(schema);
	if (Type.IsRef(schema) || schemaRef) {
		// References would need to be resolved from a schema registry
		// For now, we treat them as 'any'
		addCoercion(`unresolved reference: ${schemaRef ?? "unknown"}`);
		return value;
	}

	// Handle different schema kinds
	if (Type.IsObject(schema)) {
		return coerceObject(value, schema as TObject, options, path, depth, addCoercion, addError);
	}
	if (Type.IsArray(schema)) {
		return coerceArray(value, schema as TArray, options, path, depth, addCoercion, addError);
	}
	if (Type.IsUnion(schema)) {
		return coerceUnion(value, schema as TUnion, options, path, depth, addCoercion, addError);
	}
	if (Type.IsIntersect(schema)) {
		return coerceIntersect(value, schema, options, path, depth, addCoercion, addError);
	}
	if (Type.IsLiteral(schema)) {
		return coerceLiteral(value, schema as TLiteral, path, addError);
	}
	if (Type.IsEnum(schema)) {
		return coerceEnum(value, schema as TEnum, path, addCoercion, addError);
	}
	if (Type.IsString(schema)) {
		return coerceString(value, schema as TString, path, addCoercion, addError);
	}
	if (Type.IsNumber(schema) || Type.IsInteger(schema)) {
		return coerceNumber(value, schema as TNumber | TInteger, path, addCoercion, addError);
	}
	if (Type.IsBoolean(schema)) {
		return coerceBoolean(value, path, addCoercion, addError);
	}
	if (Type.IsNull(schema)) {
		return coerceNull(value, schema, options, path, addCoercion, addError);
	}
	if (Type.IsAny(schema) || Type.IsUnknown(schema)) {
		return value;
	}
	if (Type.IsRecord(schema)) {
		return coerceRecord(value, schema as TRecord, options, path, depth, addCoercion, addError);
	}
	if (Type.IsTuple(schema)) {
		return coerceTuple(value, schema as TTuple, options, path, depth, addCoercion, addError);
	}

	throw new Error(`Unsupported TypeBox schema at ${path || "<root>"}: no coercion strategy`);
}

function coerceObject(
	value: unknown,
	schema: TObject,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		// Try to convert array to object with index keys
		if (Array.isArray(value)) {
			addCoercion(`converted array to object with index keys at ${path}`);
			const obj: Record<string, unknown> = {};
			value.forEach((item, index) => {
				obj[String(index)] = item;
			});
			return coerceObject(obj, schema, options, path, depth, addCoercion, addError);
		}

		// Try to convert string to object (JSON parsing)
		if (typeof value === "string") {
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed === "object" && parsed !== null) {
					addCoercion(`parsed string to object at ${path}`);
					return coerceObject(parsed, schema, options, path, depth, addCoercion, addError);
				}
			} catch {
				// Not valid JSON
			}
		}

		addError(`Expected object, got ${typeof value}`, "object", typeof value);
		return value;
	}

	const properties = schema.properties as TProperties;
	if (!properties) {
		return value;
	}

	// Get required fields from the schema (TypeBox uses this for optional fields)
	const required = ((schema as any).required as string[]) || [];

	const result: Record<string, unknown> = {};
	const valueObj = value as Record<string, unknown>;

	for (const [key, propSchema] of Object.entries(properties)) {
		const fieldPath = path ? `${path}.${key}` : key;
		const fieldValue = valueObj[key];
		const isRequired = required.includes(key);

		if (fieldValue === undefined) {
			// Check for default
			const defaultValue = getSchemaDefault(propSchema as TSchema);
			if (options.useDefaults && defaultValue !== undefined) {
				result[key] = defaultValue;
				addCoercion(`used default for ${fieldPath}`);
			} else if (!isRequired || isOptionalProperty(propSchema as TSchema)) {
				// Optional field, skip
			} else if (options.allowPartials) {
				// Partial mode - leave undefined
				result[key] = undefined;
			} else {
				addError(`Missing required field: ${key}`, undefined, "undefined");
				result[key] = undefined;
			}
		} else {
			result[key] = coerceInternal(
				fieldValue,
				propSchema as TSchema,
				options,
				fieldPath,
				depth + 1,
				addCoercion,
				addError,
			);
		}
	}

	// Handle additional properties
	const additionalProps = (schema as any).additionalProperties as TSchema | boolean;
	for (const [key, fieldValue] of Object.entries(valueObj)) {
		if (!(key in properties)) {
			if (additionalProps === true || additionalProps === undefined) {
				// Allow any additional properties
				result[key] = fieldValue;
			} else if (additionalProps !== false) {
				// Validate against schema
				const fieldPath = path ? `${path}.${key}` : key;
				result[key] = coerceInternal(
					fieldValue,
					additionalProps,
					options,
					fieldPath,
					depth + 1,
					addCoercion,
					addError,
				);
			}
			// If false, ignore the property
		}
	}

	return result;
}

function coerceArray(
	value: unknown,
	schema: TArray,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	// Handle single value -> array
	if (!Array.isArray(value)) {
		addCoercion(`wrapped single value in array at ${path}`);
		const items = schema.items as TSchema;
		return [coerceInternal(value, items, options, `${path}[0]`, depth + 1, addCoercion, addError)];
	}

	const items = schema.items as TSchema;
	const result: unknown[] = [];

	for (let i = 0; i < value.length; i++) {
		const itemPath = `${path}[${i}]`;
		result.push(coerceInternal(value[i], items, options, itemPath, depth + 1, addCoercion, addError));
	}

	return result;
}

function coerceUnion(
	value: unknown,
	schema: TUnion,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	const variants = (getSchemaAnyOf(schema) ?? []) as TSchema[];

	// Try each variant and pick the one with fewest errors
	let bestResult: { value: unknown; errors: number; coercions: number } | null = null;

	for (const variant of variants) {
		// Check if this variant can handle the value
		if (canHandleValue(value, variant)) {
			// Create temporary error trackers
			const variantErrors: CoercionError[] = [];
			const variantCoercions: string[] = [];

			const result = coerceInternal(
				value,
				variant,
				options,
				path,
				depth,
				(msg) => variantCoercions.push(msg),
				(msg, exp, rec) => variantErrors.push({ path, message: msg, expected: exp, received: rec }),
			);

			if (variantErrors.length === 0) {
				// Perfect match
				for (const c of variantCoercions) {
					addCoercion(c);
				}
				return result;
			}

			if (!bestResult || variantErrors.length < bestResult.errors) {
				bestResult = {
					value: result,
					errors: variantErrors.length,
					coercions: variantCoercions.length,
				};
			}
		}
	}

	// Return the best match even if it had errors
	if (bestResult) {
		addCoercion(`selected union variant with ${bestResult.errors} errors at ${path}`);
		return bestResult.value;
	}

	// Last resort: try each variant anyway
	for (const variant of variants) {
		try {
			const result = coerceInternal(value, variant, options, path, depth, addCoercion, addError);
			addCoercion(`forced union variant at ${path}`);
			return result;
		} catch {
			// Try next
		}
	}

	addError(`No matching variant in union`);
	return value;
}

function coerceIntersect(
	value: unknown,
	schema: TSchema,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	const allOf = (schema as any).allOf as TSchema[];
	if (!allOf || allOf.length === 0) {
		return value;
	}

	// Merge all object schemas and coerce
	const merged: Record<string, TSchema> = {};
	for (const subSchema of allOf) {
		if (Type.IsObject(subSchema)) {
			const props = (subSchema as TObject).properties as TProperties;
			Object.assign(merged, props);
		}
	}

	const mergedSchema: TObject = Type.Object(merged) as TObject;
	return coerceObject(value, mergedSchema, options, path, depth, addCoercion, addError);
}

function coerceLiteral(
	value: unknown,
	schema: TLiteral,
	_path: string,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	const expected = getSchemaConst(schema);

	if (value === expected) {
		return value;
	}

	// Try string comparison
	if (String(value) === String(expected)) {
		return expected;
	}

	addError(`Expected literal ${JSON.stringify(expected)}`, JSON.stringify(expected), String(value));
	return value;
}

function coerceEnum(
	value: unknown,
	schema: TEnum,
	path: string,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	const allowed = getSchemaEnum(schema).filter(
		(item): item is string | number => typeof item === "string" || typeof item === "number",
	);

	if (allowed.includes(value as string | number)) {
		return value;
	}

	// Try case-insensitive string matching
	if (typeof value === "string") {
		const match = allowed.find((v) => typeof v === "string" && v.toLowerCase() === value.toLowerCase());
		if (match !== undefined) {
			addCoercion(`case-insensitive enum match at ${path}: ${value} -> ${match}`);
			return match;
		}
	}

	addError(`Expected one of ${allowed.map((v) => JSON.stringify(v)).join(", ")}`, "enum", String(value));
	return value;
}

function coerceString(
	value: unknown,
	schema: TString,
	path: string,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (typeof value === "string") {
		const minLength = getNumberConstraint(schema, "minLength");
		const maxLength = getNumberConstraint(schema, "maxLength");
		const pattern = getStringConstraint(schema, "pattern");
		// Validate constraints
		if (minLength !== undefined && value.length < minLength) {
			addError(`String too short (min ${minLength})`, `minLength ${minLength}`, String(value.length));
		}
		if (maxLength !== undefined && value.length > maxLength) {
			addError(`String too long (max ${maxLength})`, `maxLength ${maxLength}`, String(value.length));
		}
		if (pattern && !new RegExp(pattern).test(value)) {
			addError(`String does not match pattern /${pattern}/`, `pattern ${pattern}`, value);
		}
		return value;
	}

	// Coerce to string
	addCoercion(`coerced ${typeof value} to string at ${path}`);

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (value === null) {
		return "null";
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

function coerceNumber(
	value: unknown,
	schema: TNumber | TInteger,
	path: string,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	const isInt = Type.IsInteger(schema);

	if (typeof value === "number") {
		let num = value;
		if (isInt && !Number.isInteger(num)) {
			addCoercion(`truncated float to integer at ${path}`);
			num = Math.trunc(num);
		}
		return validateNumber(num, schema, path, addError);
	}

	if (typeof value === "string") {
		const parsed = isInt ? parseInt(value, 10) : parseFloat(value);
		if (!Number.isNaN(parsed)) {
			addCoercion(`parsed string to number at ${path}`);
			return validateNumber(parsed, schema, path, addError);
		}
	}

	if (typeof value === "boolean") {
		addCoercion(`converted boolean to number at ${path}`);
		return validateNumber(value ? 1 : 0, schema, path, addError);
	}

	addError(`Cannot coerce to ${isInt ? "integer" : "number"}`, isInt ? "integer" : "number", String(value));
	return value;
}

function validateNumber(
	num: number,
	schema: TNumber | TInteger,
	_path: string,
	addError: (msg: string, exp?: string, rec?: string) => void,
): number {
	const minimum = getNumberConstraint(schema, "minimum");
	if (minimum !== undefined && num < minimum) {
		addError(`Number below minimum (${minimum})`, `>= ${minimum}`, String(num));
	}
	const maximum = getNumberConstraint(schema, "maximum");
	if (maximum !== undefined && num > maximum) {
		addError(`Number above maximum (${maximum})`, `<= ${maximum}`, String(num));
	}
	const exclusiveMinimum = getNumberConstraint(schema, "exclusiveMinimum");
	if (exclusiveMinimum !== undefined && num <= exclusiveMinimum) {
		addError(`Number not above exclusive minimum (${exclusiveMinimum})`, `> ${exclusiveMinimum}`, String(num));
	}
	const exclusiveMaximum = getNumberConstraint(schema, "exclusiveMaximum");
	if (exclusiveMaximum !== undefined && num >= exclusiveMaximum) {
		addError(`Number not below exclusive maximum (${exclusiveMaximum})`, `< ${exclusiveMaximum}`, String(num));
	}
	const multipleOf = getNumberConstraint(schema, "multipleOf");
	if (multipleOf !== undefined && num % multipleOf !== 0) {
		addError(`Number not multiple of ${multipleOf}`, `multiple of ${multipleOf}`, String(num));
	}

	return num;
}

function coerceBoolean(
	value: unknown,
	_path: string,
	_addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "string") {
		const lower = value.toLowerCase();
		if (lower === "true" || lower === "1" || lower === "yes") {
			return true;
		}
		if (lower === "false" || lower === "0" || lower === "no" || lower === "") {
			return false;
		}
	}

	if (typeof value === "number") {
		return value !== 0;
	}

	addError(`Cannot coerce to boolean`, "boolean", String(value));
	return value;
}

function coerceNull(
	value: unknown,
	_schema: TSchema,
	options: CoercionOptions,
	path: string,
	addCoercion: (msg: string) => void,
	_addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (value === null || value === undefined) {
		return null;
	}

	// Check if this is part of an optional/union with null
	if (options.allowPartials) {
		return null;
	}

	addCoercion(`coerced ${typeof value} to null at ${path}`);
	return null;
}

function coerceRecord(
	value: unknown,
	schema: TRecord,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		addError(`Expected record object, got ${typeof value}`, "record", typeof value);
		return value;
	}

	const patternProps = (schema as any).patternProperties as Record<string, TSchema>;
	const additional = (schema as any).additionalProperties as TSchema;

	let valueSchema: TSchema;
	if (patternProps && Object.keys(patternProps).length > 0) {
		valueSchema = Object.values(patternProps)[0];
	} else if (additional && typeof additional !== "boolean") {
		valueSchema = additional;
	} else {
		valueSchema = Type.Any();
	}

	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		const keyPath = `${path}[${key}]`;
		result[key] = coerceInternal(val, valueSchema, options, keyPath, depth + 1, addCoercion, addError);
	}

	return result;
}

function coerceTuple(
	value: unknown,
	schema: TTuple,
	options: CoercionOptions,
	path: string,
	depth: number,
	addCoercion: (msg: string) => void,
	addError: (msg: string, exp?: string, rec?: string) => void,
): unknown {
	if (!Array.isArray(value)) {
		addError(`Expected tuple array, got ${typeof value}`, "tuple", typeof value);
		return value;
	}

	const items = schema.items as TSchema[];
	const result: unknown[] = [];

	for (let i = 0; i < items.length; i++) {
		const itemPath = `${path}[${i}]`;
		if (i < value.length) {
			result.push(coerceInternal(value[i], items[i], options, itemPath, depth + 1, addCoercion, addError));
		} else {
			// Missing element - use default or undefined
			const defaultValue = getSchemaDefault(items[i]);
			if (defaultValue !== undefined) {
				result.push(defaultValue);
			} else {
				addError(`Missing tuple element at index ${i}`);
				result.push(undefined);
			}
		}
	}

	// Handle extra elements if additionalItems is allowed
	const additionalItems = (schema as any).additionalItems;
	if (additionalItems !== false) {
		for (let i = items.length; i < value.length; i++) {
			result.push(value[i]);
		}
	}

	return result;
}

/**
 * Check if a value can potentially be handled by a schema
 */
function canHandleValue(value: unknown, schema: TSchema): boolean {
	if (Type.IsAny(schema) || Type.IsUnknown(schema)) {
		return true;
	}

	if (value === null || value === undefined) {
		return Type.IsNull(schema) || Type.IsOptional(schema) || isNullable(schema);
	}

	if (Type.IsString(schema)) {
		return typeof value === "string";
	}
	if (Type.IsInteger(schema)) {
		return typeof value === "number" && Number.isInteger(value);
	}
	if (Type.IsNumber(schema) || Type.IsInteger(schema)) {
		return typeof value === "number";
	}
	if (Type.IsBoolean(schema)) {
		return typeof value === "boolean";
	}
	if (Type.IsObject(schema)) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	if (Type.IsArray(schema)) {
		return Array.isArray(value);
	}
	if (Type.IsLiteral(schema)) {
		return value === getSchemaConst(schema);
	}
	if (Type.IsEnum(schema)) {
		return getSchemaEnum(schema).includes(value);
	}
	if (Type.IsUnion(schema) || getSchemaAnyOf(schema)) {
		return (getSchemaAnyOf(schema) ?? []).some((s) => canHandleValue(value, s));
	}
	return true;
}

function isNullable(schema: TSchema): boolean {
	const anyOf = getSchemaAnyOf(schema);
	if (anyOf) {
		return anyOf.some((s) => Type.IsNull(s));
	}
	return false;
}

function isOptionalProperty(schema: TSchema): boolean {
	if (Type.IsOptional(schema)) {
		return true;
	}
	const anyOf = getSchemaAnyOf(schema);
	if (anyOf) {
		return anyOf.some((s) => Type.IsNull(s) || Type.IsUndefined(s));
	}
	return false;
}

function isComplete(value: unknown, schema: TSchema): boolean {
	if (Type.IsObject(schema)) {
		if (typeof value !== "object" || value === null) {
			return false;
		}
		const properties = (schema as TObject).properties as TProperties;
		const required = ((schema as any).required as string[]) || [];
		for (const key of Object.keys(properties)) {
			if (required.includes(key)) {
				if (!(key in (value as Record<string, unknown>))) {
					return false;
				}
			}
		}
	}

	if (Type.IsArray(schema)) {
		if (!Array.isArray(value)) {
			return false;
		}
		// Arrays are considered complete if they have elements
		return value.length > 0;
	}

	return value !== undefined && value !== null;
}

/**
 * Validate a value against a schema without coercion
 */
export function validateValue<T extends TSchema>(
	value: unknown,
	schema: T,
): { valid: boolean; errors: CoercionError[] } {
	assertTypeBoxSchema(schema, "<root>");
	const errors: CoercionError[] = [];

	function addError(path: string, message: string, expected?: string, received?: string) {
		errors.push({ path, message, expected, received });
	}

	const valid = Value.Check(schema, value);

	if (!valid) {
		const typeboxErrors = Value.Errors(schema, value);
		for (const error of typeboxErrors) {
			const path = "instancePath" in error ? String(error.instancePath) : "";
			const invalidValue = Value.Pointer.Get(value, path);
			addError(path, error.message, undefined, invalidValue === undefined ? undefined : String(invalidValue));
		}
	}

	return { valid, errors };
}
