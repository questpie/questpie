import type {
	AnyCollectionOrBuilder,
	CMSConfig,
	CRUD,
	GetCollection,
	GetGlobal,
	GlobalCRUD,
	QCMS,
} from "#questpie/cms/exports/server.js";
import type { RequestContext } from "#questpie/cms/server/config/context";
import { executeJsonFunction } from "#questpie/cms/server/functions/execute";
import type {
	ExtractJsonFunctions,
	FunctionsMap,
	InferFunctionInput,
	InferFunctionOutput,
	JsonFunctionDefinition,
} from "#questpie/cms/server/functions/types";
import type {
	CollectionFunctions,
	CollectionInsert,
	CollectionRelations,
	CollectionSelect,
	CollectionUpdate,
	GlobalFunctions,
	GlobalInsert,
	GlobalRelations,
	GlobalSelect,
	GlobalUpdate,
	ResolveRelationsDeep,
} from "#questpie/cms/shared/type-utils.js";

type JsonFunctionCaller<TDefinition extends JsonFunctionDefinition<any, any>> =
	(
		input: InferFunctionInput<TDefinition>,
		context?: RequestContext,
	) => Promise<InferFunctionOutput<TDefinition>>;

type RootFunctionsAPI<TFunctions extends FunctionsMap> = {
	[K in keyof ExtractJsonFunctions<TFunctions>]: ExtractJsonFunctions<TFunctions>[K] extends JsonFunctionDefinition<
		any,
		any
	>
		? JsonFunctionCaller<ExtractJsonFunctions<TFunctions>[K]>
		: never;
};

type CollectionFunctionsAPI<TCollection, _TCollections> = {
	[K in keyof ExtractJsonFunctions<
		CollectionFunctions<TCollection>
	>]: ExtractJsonFunctions<
		CollectionFunctions<TCollection>
	>[K] extends JsonFunctionDefinition<any, any>
		? JsonFunctionCaller<
				ExtractJsonFunctions<CollectionFunctions<TCollection>>[K]
			>
		: never;
};

type GlobalFunctionsAPI<TGlobal> = {
	[K in keyof ExtractJsonFunctions<
		GlobalFunctions<TGlobal>
	>]: ExtractJsonFunctions<
		GlobalFunctions<TGlobal>
	>[K] extends JsonFunctionDefinition<any, any>
		? JsonFunctionCaller<ExtractJsonFunctions<GlobalFunctions<TGlobal>>[K]>
		: never;
};

type CollectionAPI<
	TCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = CRUD<
	CollectionSelect<TCollection>,
	CollectionInsert<TCollection>,
	CollectionUpdate<TCollection>,
	ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
> &
	CollectionFunctionsAPI<TCollection, TCollections>;

type GlobalAPI<
	TGlobal,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = GlobalCRUD<
	GlobalSelect<TGlobal>,
	GlobalInsert<TGlobal>,
	GlobalUpdate<TGlobal>,
	ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>
> &
	GlobalFunctionsAPI<TGlobal>;

export type QCMSApi<TConfig extends CMSConfig = CMSConfig> = QCMSAPI<TConfig> &
	RootFunctionsAPI<NonNullable<TConfig["functions"]>>;

export class QCMSAPI<TConfig extends CMSConfig = CMSConfig> {
	constructor(readonly cms: QCMS<TConfig>) {
		this.registerRootFunctions();
	}

	private registerRootFunctions() {
		const functions = this.cms.getFunctions() as FunctionsMap;

		for (const [name, definition] of Object.entries(functions)) {
			if (definition.mode === "raw") continue;
			if (name in this) {
				throw new Error(`Function "${name}" collides with existing API keys.`);
			}

			Object.defineProperty(this, name, {
				get: () => this.createJsonFunctionCaller(definition),
				enumerable: true,
			});
		}
	}

	private createJsonFunctionCaller(
		definition: JsonFunctionDefinition<any, any>,
	) {
		return async (input: unknown, context?: RequestContext) => {
			return executeJsonFunction(this.cms, definition, input as never, context);
		};
	}

	private createCollectionFunctions(
		functions: FunctionsMap,
		crud: Record<string, any>,
	) {
		const output: Record<string, any> = {};

		for (const [name, definition] of Object.entries(functions)) {
			if (definition.mode === "raw") continue;
			if (name in crud) {
				throw new Error(
					`Function "${name}" collides with collection CRUD method.`,
				);
			}
			output[name] = this.createJsonFunctionCaller(definition);
		}

		return output;
	}

	private createGlobalFunctions(
		functions: FunctionsMap,
		crud: Record<string, any>,
	) {
		const output: Record<string, any> = {};

		for (const [name, definition] of Object.entries(functions)) {
			if (definition.mode === "raw") continue;
			if (name in crud) {
				throw new Error(`Function "${name}" collides with global CRUD method.`);
			}
			output[name] = this.createJsonFunctionCaller(definition);
		}

		return output;
	}

	/**
	 * Access collections CRUD operations
	 * @example
	 * await cms.api.collections.users.create({ email: '...' }, context)
	 * await cms.api.collections.posts.find({ where: { status: 'published' } })
	 */
	public get collections(): {
		[K in keyof TConfig["collections"]]: CollectionAPI<
			GetCollection<TConfig["collections"], K>,
			TConfig["collections"]
		>;
	} {
		const collectionsProxy = {};
		const collectionsObj = this.cms.getCollections();

		for (const [name, collection] of Object.entries(collectionsObj)) {
			Object.defineProperty(collectionsProxy, name, {
				get: () => {
					const crud = collection.generateCRUD(this.cms.db, this.cms) as any;
					const functions = this.createCollectionFunctions(
						collection.state.functions || {},
						crud,
					);
					return {
						...crud,
						...functions,
					};
				},
				enumerable: true,
			});
		}

		return collectionsProxy as {
			[K in keyof TConfig["collections"]]: CollectionAPI<
				GetCollection<TConfig["collections"], K>,
				TConfig["collections"]
			>;
		};
	}

	public get globals(): {
		[K in keyof NonNullable<TConfig["globals"]>]: GlobalAPI<
			GetGlobal<NonNullable<TConfig["globals"]>, K>,
			TConfig["collections"]
		>;
	} {
		const globalsProxy = {};
		const globalsObj = this.cms.getGlobals();

		for (const [name, global] of Object.entries(globalsObj)) {
			Object.defineProperty(globalsProxy, name, {
				get: () => {
					const crud = global.generateCRUD(this.cms.db, this.cms) as any;
					const functions = this.createGlobalFunctions(
						global.state.functions || {},
						crud,
					);
					return {
						...crud,
						...functions,
					};
				},
				enumerable: true,
			});
		}

		return globalsProxy as {
			[K in keyof NonNullable<TConfig["globals"]>]: GlobalAPI<
				GetGlobal<NonNullable<TConfig["globals"]>, K>,
				TConfig["collections"]
			>;
		};
	}
}
