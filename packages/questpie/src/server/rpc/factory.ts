import { fn } from "#questpie/server/functions/define-function.js";
import type { RpcBuilder } from "#questpie/server/rpc/types.js";

export function rpc<TApp = any>(): RpcBuilder<TApp> {
	const typedFn = fn.typed<TApp>();

	return {
		fn: typedFn,
		router<TRouter extends Record<string, any>>(router: TRouter): TRouter {
			return router;
		},
	} as RpcBuilder<TApp>;
}
