/**
 * Access Control Utilities
 *
 * Pure functions for handling access control in CRUD operations.
 * Supports boolean and function-based access rules.
 */

import type {
	AccessContext,
	AccessWhere,
	CollectionAccess,
} from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type {
	FieldAccess,
	FieldAccessContext,
} from "#questpie/server/fields/types.js";

import { getDb, normalizeContext } from "./context.js";

/** Internal, non-JSON marker for access already evaluated before CRUD hooks. */
export const PRECHECKED_READ_ACCESS = Symbol("questpie.precheckedReadAccess");
/** Internal, non-JSON marker that keeps access predicates fail-closed in SQL compilation. */
export const ACCESS_WHERE = Symbol("questpie.accessWhere");

export function isAccessWhere(value: unknown): boolean {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { [ACCESS_WHERE]?: unknown })[ACCESS_WHERE] === true
	);
}

type FieldDefinitionLike = {
	_state?: {
		access?: FieldAccess;
		input?: unknown;
		output?: unknown;
		nestedFields?: Record<string, unknown>;
	};
};

/**
 * Context for access rule evaluation
 */
export interface AccessRuleEvaluationContext {
	app?: Questpie<any>;
	db: any;
	session?: CRUDContext["session"];
	principal?: CRUDContext["principal"];
	actor?: CRUDContext["actor"];
	locale?: string;
	row?: any;
	input?: any;
	/** Incoming HTTP request when called via an HTTP adapter */
	request?: Request;
	/**
	 * Request-context extensions resolved by `appConfig({ context })` —
	 * spread flat into the rule ctx (after services, before per-op keys).
	 */
	contextExtensions?: Record<string, unknown>;
}

/**
 * Execute an access rule and return boolean or AccessWhere.
 *
 * **Default behavior (no rule defined):**
 * When no access rule is provided (`undefined`), the system defaults to
 * requiring an authenticated session (`!!context.session`). This means:
 * - Authenticated requests → allowed
 * - Unauthenticated requests → denied
 *
 * This "secure by default" behavior is the last resort when:
 * 1. The collection/global has no `.access()` rule for the operation, AND
 * 2. No `defaultAccess` is configured via `.defaultAccess()` on the builder
 *
 * To make a resource publicly accessible, explicitly set the rule to `true`
 * (e.g., `.access({ read: true })` or `.defaultAccess({ read: true })`).
 *
 * @param rule - The access rule to execute (boolean, function, or undefined)
 * @param context - Evaluation context including session, db, app
 * @returns true (allow), false (deny), or AccessWhere (conditional access)
 */
export async function executeAccessRule(
	// Accepts both plain AccessRule and RowAccessRule callbacks — row-aware
	// rules type ctx.data as non-optional, but every caller that evaluates one
	// passes the loaded row, so the runtime contract holds.
	rule:
		| boolean
		| ((
				ctx: AccessContext & { data: any },
		  ) => boolean | AccessWhere | Promise<boolean | AccessWhere>)
		| undefined,
	context: AccessRuleEvaluationContext,
): Promise<boolean | AccessWhere> {
	// No rule = require session (secure by default)
	// To allow public access, explicitly set the rule to `true`
	if (rule === undefined) return !!context.session;

	// Boolean rule
	if (typeof rule === "boolean") {
		return rule;
	}

	// Function rule
	if (typeof rule === "function") {
		const services = extractAppServices(context.app, {
			db: context.db,
			session: context.session,
			principal: context.principal,
			actor: context.actor,
		});
		// data is non-optional for RowAccessRule callers (they always pass the
		// loaded row); plain rules tolerate undefined — widen via the cast.
		const result = await rule({
			...services,
			...(context.contextExtensions ?? {}),
			data: context.row as any,
			input: context.input,
			locale: context.locale,
			request: context.request,
		} as AccessContext & { data: any });

		return result;
	}

	return true;
}

/**
 * Check if a row matches access conditions recursively
 *
 * @param conditions - AccessWhere conditions to check
 * @param row - Row data to check against
 * @returns true if row matches conditions
 */
export async function matchesAccessConditions(
	conditions: AccessWhere,
	row: Record<string, any>,
): Promise<boolean> {
	for (const [key, value] of Object.entries(conditions)) {
		if (key === "AND") {
			// All conditions must match
			for (const cond of value as AccessWhere[]) {
				if (!(await matchesAccessConditions(cond, row))) {
					return false;
				}
			}
		} else if (key === "OR") {
			// At least one condition must match
			let anyMatch = false;
			for (const cond of value as AccessWhere[]) {
				if (await matchesAccessConditions(cond, row)) {
					anyMatch = true;
					break;
				}
			}
			if (!anyMatch) return false;
		} else if (key === "NOT") {
			// Condition must NOT match
			if (await matchesAccessConditions(value as AccessWhere, row)) {
				return false;
			}
		} else {
			// Simple field equality check
			if (row[key] !== value) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Match row-aware access conditions only when the complete condition tree can
 * be evaluated by the in-memory equality matcher.
 *
 * Purge uses this stricter boundary because an unsupported leaf nested below
 * `NOT` must deny the irreversible operation instead of being inverted into an
 * allow. Query CRUD continues to use the SQL condition builder, which supports
 * its wider operator vocabulary.
 */
export async function matchesStrictAccessConditions(
	conditions: AccessWhere,
	row: Record<string, any>,
): Promise<boolean> {
	if (!isStrictAccessWhereMatchable(conditions, row)) {
		return false;
	}

	return matchesAccessConditions(conditions, row);
}

function isStrictAccessWhereMatchable(
	conditions: AccessWhere,
	row: Record<string, any>,
): boolean {
	if (
		conditions === null ||
		typeof conditions !== "object" ||
		Array.isArray(conditions)
	) {
		return false;
	}

	for (const [key, value] of Object.entries(conditions)) {
		if (key === "AND" || key === "OR") {
			if (
				!Array.isArray(value) ||
				!value.every((condition) =>
					isStrictAccessWhereMatchable(condition as AccessWhere, row),
				)
			) {
				return false;
			}
			continue;
		}

		if (key === "NOT") {
			if (!isStrictAccessWhereMatchable(value as AccessWhere, row)) {
				return false;
			}
			continue;
		}

		if (
			!Object.hasOwn(row, key) ||
			(value !== null && typeof value === "object") ||
			value === undefined
		) {
			return false;
		}
	}

	return true;
}

/**
 * Options for filtering fields based on read access
 */
export interface FilterFieldsForReadOptions {
	app?: Questpie<any>;
	db: any;
	fieldAccess?: Record<string, FieldAccess>;
}

function mergeFieldAccessMaps(
	...maps: Array<Record<string, FieldAccess> | undefined>
): Record<string, FieldAccess> | undefined {
	const merged: Record<string, FieldAccess> = {};

	for (const map of maps) {
		if (!map) continue;
		for (const [fieldPath, rule] of Object.entries(map)) {
			merged[fieldPath] = {
				...merged[fieldPath],
				...rule,
			};
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}

function deriveFieldAccessLayers(
	fieldDefinitions: Record<string, unknown> | undefined,
): {
	fieldAccess?: Record<string, FieldAccess>;
	fieldFlags?: Record<string, FieldAccess>;
} {
	const fieldAccess: Record<string, FieldAccess> = {};
	const fieldFlags: Record<string, FieldAccess> = {};

	if (!fieldDefinitions) {
		return {};
	}

	const collect = (definitions: Record<string, unknown>, prefix?: string) => {
		for (const [fieldName, fieldDefinition] of Object.entries(definitions)) {
			const fieldPath = prefix ? `${prefix}.${fieldName}` : fieldName;
			const state = (fieldDefinition as FieldDefinitionLike)._state;
			if (!state) continue;

			if (state.access) {
				fieldAccess[fieldPath] = state.access;
			}

			const flags: FieldAccess = {};
			if (state.output === false) {
				flags.read = false;
			}
			if (state.input === false) {
				flags.create = false;
				flags.update = false;
			}
			if (Object.keys(flags).length > 0) {
				fieldFlags[fieldPath] = flags;
			}

			if (state.nestedFields) {
				collect(state.nestedFields, fieldPath);
			}
		}
	};

	collect(fieldDefinitions);
	return {
		fieldAccess: Object.keys(fieldAccess).length > 0 ? fieldAccess : undefined,
		fieldFlags: Object.keys(fieldFlags).length > 0 ? fieldFlags : undefined,
	};
}

export function deriveFieldAccessFromDefinitions(
	fieldDefinitions: Record<string, unknown> | undefined,
): Record<string, FieldAccess> | undefined {
	const layers = deriveFieldAccessLayers(fieldDefinitions);
	return mergeFieldAccessMaps(layers.fieldAccess, layers.fieldFlags);
}

export function mergeFieldAccessRules(
	fieldAccess: Record<string, FieldAccess> | undefined,
	fieldDefinitions: Record<string, unknown> | undefined,
): Record<string, FieldAccess> | undefined {
	const layers = deriveFieldAccessLayers(fieldDefinitions);
	return mergeFieldAccessMaps(
		layers.fieldAccess,
		fieldAccess,
		layers.fieldFlags,
	);
}

export function getRequestFromContext(
	context: CRUDContext,
): Request | undefined {
	const ctx = context as Record<string, unknown>;
	const req = ctx.req ?? ctx.request;
	return typeof Request !== "undefined" && req instanceof Request
		? req
		: undefined;
}

export function createFieldAccessContext(params: {
	context: CRUDContext;
	operation: "create" | "read" | "update" | "delete";
	doc?: Record<string, unknown>;
}): FieldAccessContext {
	const req = getRequestFromContext(params.context);

	return {
		// Request-context extensions (appConfig({ context })) — flat, runtime-only
		...(params.context["~contextExtensions"] ?? {}),
		...(req ? { req } : {}),
		// session is typed as { user: User; session: Session } | null | undefined
		user: params.context.session?.user,
		principal: params.context.principal,
		actor: params.context.actor,
		doc: params.doc,
		operation: params.operation,
	};
}

async function evaluateFieldAccess(
	rule: FieldAccess["read"] | FieldAccess["create"] | FieldAccess["update"],
	context: FieldAccessContext,
): Promise<boolean> {
	if (rule === undefined || rule === true) return true;
	if (rule === false) return false;
	if (typeof rule === "function") {
		return (await rule(context)) === true;
	}
	return true;
}

/**
 * Get list of fields that should be restricted from read
 *
 * @param result - Row data to check
 * @param context - CRUD context
 * @param options - Configuration options
 * @returns Array of field names to remove
 */
export async function getRestrictedReadFields(
	result: Record<string, any>,
	context: CRUDContext,
	options: FilterFieldsForReadOptions,
): Promise<string[]> {
	if (!result) return [];

	const normalized = normalizeContext(context);

	// System mode bypasses field access control
	if (normalized.accessMode === "system") return [];

	const fieldAccess = options.fieldAccess;
	if (!fieldAccess) return [];

	const fieldsToRemove: string[] = [];

	for (const [fieldName, access] of Object.entries(fieldAccess)) {
		// Skip meta fields
		if (
			fieldName === "id" ||
			fieldName === "_title" ||
			fieldName === "createdAt" ||
			fieldName === "updatedAt" ||
			fieldName === "deletedAt"
		) {
			continue;
		}

		if (!access || access.read === undefined) {
			// No access rule for this field - allow read
			continue;
		}

		const canRead = await evaluateFieldAccess(
			access.read,
			createFieldAccessContext({
				context: normalized,
				operation: "read",
				doc: result,
			}),
		);

		if (!canRead) {
			const path = fieldName.split(".");
			if (hasPathValue(result, path)) {
				fieldsToRemove.push(fieldName);
			}
		}
	}

	return fieldsToRemove;
}

/**
 * Check if user can write to a specific field
 *
 * @param fieldName - Name of the field
 * @param fieldAccess - Field access rules
 * @param context - CRUD context
 * @param options - Configuration options
 * @param existingRow - Optional existing row data (for update operations)
 * @returns true if user can write to field
 */
export async function checkFieldWriteAccess(
	fieldName: string,
	fieldAccess: Record<string, FieldAccess> | undefined,
	context: CRUDContext,
	options: { app?: Questpie<any>; db: any },
	operation: "create" | "update",
	existingRow?: any,
): Promise<boolean> {
	const normalized = normalizeContext(context);

	// System mode can write all fields
	if (normalized.accessMode === "system") return true;

	if (!fieldAccess) return true;

	const access = fieldAccess[fieldName];
	if (!access) {
		// No access rule for this field - allow write
		return true;
	}

	const rule = operation === "create" ? access.create : access.update;
	return evaluateFieldAccess(
		rule,
		createFieldAccessContext({
			context: normalized,
			operation,
			doc: existingRow,
		}),
	);
}

const META_FIELD_NAMES = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

function isRecord(value: unknown): value is Record<string, any> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPathValue(source: unknown, path: Array<string | number>): unknown {
	let current = source;
	for (const segment of path) {
		if (!isRecord(current) && !Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function hasPathValue(source: unknown, path: string[]): boolean {
	if (path.length === 0) return true;
	if (Array.isArray(source)) {
		return source.some((item) => hasPathValue(item, path));
	}
	if (!isRecord(source)) return false;

	const [head, ...tail] = path;
	if (!(head in source)) return false;
	if (tail.length === 0) return true;
	return hasPathValue(source[head], tail);
}

function deletePathValue(source: unknown, path: string[]): void {
	if (path.length === 0) return;
	if (Array.isArray(source)) {
		for (const item of source) {
			deletePathValue(item, path);
		}
		return;
	}
	if (!isRecord(source)) return;

	const [head, ...tail] = path;
	if (tail.length === 0) {
		delete source[head];
		return;
	}
	deletePathValue(source[head], tail);
}

export function removeRestrictedReadFields(
	result: Record<string, any>,
	fieldsToRemove: string[],
): void {
	for (const fieldName of fieldsToRemove) {
		deletePathValue(result, fieldName.split("."));
	}
}

async function validateFieldPathWriteAccess(params: {
	data: unknown;
	fieldAccess: Record<string, FieldAccess>;
	context: CRUDContext;
	options: { app?: Questpie<any>; db: any };
	collectionName: string;
	operation: "create" | "update";
	existingRow?: any;
	accessPath?: string[];
	valuePath?: Array<string | number>;
}): Promise<void> {
	if (!isRecord(params.data) && !Array.isArray(params.data)) return;

	if (Array.isArray(params.data)) {
		for (const [index, item] of params.data.entries()) {
			await validateFieldPathWriteAccess({
				...params,
				data: item,
				valuePath: [...(params.valuePath ?? []), index],
			});
		}
		return;
	}

	for (const [fieldName, value] of Object.entries(params.data)) {
		if (!params.accessPath?.length && META_FIELD_NAMES.has(fieldName)) {
			continue;
		}

		const accessPath = [...(params.accessPath ?? []), fieldName];
		const valuePath = [...(params.valuePath ?? []), fieldName];
		const fieldPath = accessPath.join(".");

		if (
			params.operation === "update" &&
			params.existingRow &&
			Object.is(value, getPathValue(params.existingRow, valuePath))
		) {
			continue;
		}

		const canWrite = await checkFieldWriteAccess(
			fieldPath,
			params.fieldAccess,
			params.context,
			params.options,
			params.operation,
			params.existingRow,
		);

		if (!canWrite) {
			const { ApiError } = await import("#questpie/server/errors/index.js");
			throw ApiError.forbidden({
				operation: params.operation,
				resource: params.collectionName,
				reason: `Cannot write field '${fieldPath}': access denied`,
				fieldPath,
			});
		}

		if (isRecord(value) || Array.isArray(value)) {
			await validateFieldPathWriteAccess({
				...params,
				data: value,
				accessPath,
				valuePath,
			});
		}
	}
}

/**
 * Validate write access for all fields in input data
 * Throws ApiError if any field cannot be written
 *
 * @param data - Input data to validate
 * @param fieldAccess - Field access rules
 * @param context - CRUD context
 * @param options - Configuration options
 * @param existingRow - Optional existing row data (for update operations)
 * @param collectionName - Collection name for error message
 */
export async function validateFieldsWriteAccess(
	data: Record<string, any>,
	fieldAccess: Record<string, FieldAccess> | undefined,
	context: CRUDContext,
	options: { app?: Questpie<any>; db: any },
	collectionName: string,
	operation: "create" | "update",
	existingRow?: any,
): Promise<void> {
	const normalized = normalizeContext(context);

	// System mode bypasses field access control
	if (normalized.accessMode === "system") return;

	if (!fieldAccess) return;

	await validateFieldPathWriteAccess({
		data,
		fieldAccess,
		context,
		options,
		collectionName,
		operation,
		existingRow,
	});
}

/**
 * Merge user WHERE with access control WHERE conditions
 *
 * @param userWhere - User-provided WHERE clause
 * @param accessWhere - Access control conditions
 * @returns Merged WHERE clause
 */
export function mergeWhereWithAccess<TWhere = any>(
	userWhere?: TWhere,
	accessWhere?: boolean | AccessWhere,
): TWhere | undefined {
	// Access explicitly denied - caller should handle this and throw forbidden
	// This function should not be called with accessWhere === false
	// The CRUD layer checks for false before calling this function
	if (accessWhere === false) {
		throw new Error(
			"mergeWhereWithAccess called with accessWhere === false. " +
				"This should be handled at the CRUD level by throwing a forbidden error.",
		);
	}

	// Access explicitly allowed or no access rule - use user WHERE only
	if (accessWhere === true || !accessWhere) {
		return userWhere;
	}

	const markedAccessWhere = Object.defineProperty(
		{ ...accessWhere },
		ACCESS_WHERE,
		{ value: true },
	);

	// Merge access conditions with user conditions
	if (!userWhere) {
		return markedAccessWhere as TWhere;
	}

	// Combine with AND
	return {
		AND: [userWhere, markedAccessWhere],
	} as TWhere;
}
