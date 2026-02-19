import type { Questpie } from "#questpie/exports/index.js";
import type {
	FunctionDefinition,
	JsonFunctionDefinition,
	RawFunctionDefinition,
} from "#questpie/server/functions/types.js";

export type RpcProcedureDefinition<
	TInput = any,
	TOutput = any,
	TApp extends Questpie = any,
> = FunctionDefinition<TInput, TOutput, TApp>;

export type RpcRouterTree<TApp extends Questpie = any> = {
	[key: string]: RpcProcedureDefinition<any, any, TApp> | RpcRouterTree<TApp>;
};

export interface RpcBuilder<TApp extends Questpie = any> {
	fn<TInput, TOutput>(
		definition: JsonFunctionDefinition<TInput, TOutput, TApp>,
	): JsonFunctionDefinition<TInput, TOutput, TApp>;
	fn(definition: RawFunctionDefinition<TApp>): RawFunctionDefinition<TApp>;
	router<TRouter extends RpcRouterTree<TApp>>(router: TRouter): TRouter;
}
