import type { RequestContext } from "#questpie/server/config/context.js";
import type {
	FieldDefinition,
	FieldDefinitionState,
	FieldHookContext,
	FieldHooks,
} from "#questpie/server/fields/types.js";

type RuntimeOperation = "create" | "read" | "update";

type FieldDefinitionsMap = Record<
	string,
	FieldDefinition<FieldDefinitionState>
>;

function getRequest(context: RequestContext): Request {
	const maybeReq = (context as any).req ?? (context as any).request;
	if (maybeReq instanceof Request) {
		return maybeReq;
	}

	if (typeof Request !== "undefined") {
		return new Request("http://questpie.local");
	}

	return {} as Request;
}

function createFieldHookContext(params: {
	fieldName: string;
	collectionName: string;
	operation: RuntimeOperation;
	context: RequestContext;
	db: any;
	config: Record<string, unknown>;
	document: Record<string, unknown>;
	originalValue?: unknown;
}): FieldHookContext {
	return {
		field: params.fieldName,
		collection: params.collectionName,
		operation: params.operation,
		req: getRequest(params.context),
		user: (params.context.session as any)?.user,
		doc: params.document,
		originalValue: params.originalValue,
		db: params.db,
		config: params.config,
	};
}

export async function applyFieldInputHooks(params: {
	data: Record<string, unknown>;
	fieldDefinitions: FieldDefinitionsMap | undefined;
	collectionName: string;
	operation: "create" | "update";
	context: RequestContext;
	db: any;
	originalDocument?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	if (!params.fieldDefinitions) return params.data;

	const nextData: Record<string, unknown> = { ...params.data };

	for (const [fieldName, fieldDef] of Object.entries(params.fieldDefinitions)) {
		if (!(fieldName in nextData)) continue;

		const hooks = fieldDef.state.config?.hooks as
			| FieldHooks<unknown>
			| undefined;
		if (!hooks) continue;

		const fieldConfig = (fieldDef.state.config ?? {}) as Record<
			string,
			unknown
		>;
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
	context: RequestContext;
	db: any;
	originalDocument?: Record<string, unknown>;
}): Promise<void> {
	if (!params.fieldDefinitions) return;

	for (const [fieldName, fieldDef] of Object.entries(params.fieldDefinitions)) {
		if (!(fieldName in params.data)) continue;

		const hooks = fieldDef.state.config?.hooks as
			| FieldHooks<unknown>
			| undefined;
		if (!hooks?.afterRead) continue;

		const fieldConfig = (fieldDef.state.config ?? {}) as Record<
			string,
			unknown
		>;
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
