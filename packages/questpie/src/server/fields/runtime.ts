import type { BaseRequestContext } from "#questpie/server/config/context.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import type {
	FieldHookContext,
	FieldHooks,
} from "#questpie/server/fields/types.js";
import { parseRfc3339Instant } from "#questpie/shared/temporal.js";

type RuntimeOperation = "create" | "read" | "update";

type FieldDefinitionsMap = Record<string, Field<FieldState>>;

function getRequest(context: BaseRequestContext): Request | undefined {
	const maybeReq = (context as any).req ?? (context as any).request;
	if (maybeReq instanceof Request) {
		return maybeReq;
	}

	return undefined;
}

function createFieldHookContext(params: {
	fieldName: string;
	collectionName: string;
	operation: RuntimeOperation;
	context: BaseRequestContext;
	db: any;
	config: Record<string, unknown>;
	document: Record<string, unknown>;
	originalValue?: unknown;
}): FieldHookContext {
	const req = getRequest(params.context);

	return {
		field: params.fieldName,
		collection: params.collectionName,
		operation: params.operation,
		...(req ? { req } : {}),
		user: (params.context.session as any)?.user,
		doc: params.document,
		originalValue: params.originalValue,
		db: params.db,
		config: params.config,
	};
}

function hydrateFieldOutput(field: Field<FieldState>, value: unknown): unknown {
	if (value === null || value === undefined) return value;
	const state = field._state;

	if (state.isArray === true) {
		if (!Array.isArray(value)) {
			throw new TypeError("QUESTPIE array field returned a non-array value");
		}
		const innerField = state.innerField as Field<FieldState> | undefined;
		return innerField
			? value.map((item) => hydrateFieldOutput(innerField, item))
			: value;
	}

	if (state.type === "datetime") {
		const instant = parseRfc3339Instant(value);
		if (!instant) {
			throw new TypeError(
				"QUESTPIE datetime field returned an invalid stored instant",
			);
		}
		return instant;
	}

	if (state.type === "object" && state.nestedFields) {
		if (typeof value !== "object" || Array.isArray(value)) {
			throw new TypeError("QUESTPIE object field returned a non-object value");
		}
		const output = { ...(value as Record<string, unknown>) };
		for (const [fieldName, nestedField] of Object.entries(
			state.nestedFields as Record<string, Field<FieldState>>,
		)) {
			if (!(fieldName in output)) continue;
			output[fieldName] = hydrateFieldOutput(nestedField, output[fieldName]);
		}
		return output;
	}

	return value;
}

export async function applyFieldInputHooks(params: {
	data: Record<string, unknown>;
	fieldDefinitions: FieldDefinitionsMap | undefined;
	collectionName: string;
	operation: "create" | "update";
	context: BaseRequestContext;
	db: any;
	originalDocument?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	if (!params.fieldDefinitions) return params.data;

	const nextData: Record<string, unknown> = { ...params.data };

	for (const [fieldName, fieldDef] of Object.entries(params.fieldDefinitions)) {
		if (!(fieldName in nextData)) continue;

		const hooks = fieldDef._state.hooks as FieldHooks<unknown> | undefined;
		if (!hooks) continue;

		const fieldConfig = fieldDef._state as Record<string, unknown>;
		let value = nextData[fieldName];
		const document = {
			...(params.originalDocument ?? {}),
			...nextData,
		};

		const hookContext = createFieldHookContext({
			fieldName,
			collectionName: params.collectionName,
			operation: params.operation,
			context: params.context,
			db: params.db,
			config: fieldConfig,
			document,
			originalValue: params.originalDocument?.[fieldName],
		});

		if (hooks.validate) {
			await hooks.validate(value, hookContext);
		}

		if (params.operation === "create" && hooks.beforeCreate) {
			value = await hooks.beforeCreate(value, hookContext);
		}

		if (params.operation === "update" && hooks.beforeUpdate) {
			value = await hooks.beforeUpdate(value, hookContext);
		}

		if (hooks.beforeChange) {
			value = await hooks.beforeChange(value, hookContext);
		}

		nextData[fieldName] = value;
	}

	return nextData;
}

export async function applyFieldOutputHooks(params: {
	data: Record<string, unknown>;
	fieldDefinitions: FieldDefinitionsMap | undefined;
	collectionName: string;
	operation: RuntimeOperation;
	context: BaseRequestContext;
	db: any;
	originalDocument?: Record<string, unknown>;
}): Promise<void> {
	if (!params.fieldDefinitions) return;

	for (const [fieldName, fieldDef] of Object.entries(params.fieldDefinitions)) {
		if (!(fieldName in params.data)) continue;
		params.data[fieldName] = hydrateFieldOutput(
			fieldDef,
			params.data[fieldName],
		);

		const hooks = fieldDef._state.hooks as FieldHooks<unknown> | undefined;
		if (!hooks?.afterRead) continue;

		const fieldConfig = fieldDef._state as Record<string, unknown>;
		const hookContext = createFieldHookContext({
			fieldName,
			collectionName: params.collectionName,
			operation: params.operation,
			context: params.context,
			db: params.db,
			config: fieldConfig,
			document: params.data,
			originalValue: params.originalDocument?.[fieldName],
		});

		params.data[fieldName] = await hooks.afterRead(
			params.data[fieldName],
			hookContext,
		);
	}
}
