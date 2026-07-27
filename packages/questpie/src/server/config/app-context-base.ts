/**
 * Base handler context — infrastructure + default services namespace.
 *
 * Kept separate from {@link AppContext} so global hook types do not import
 * the full AppContext export (avoids `_Module` circular inference in codegen).
 */
declare global {
	namespace Questpie {
		interface AppContextBase {
			app?: unknown;
			db?: any;
			session?: any | null;
			principal?: import("#questpie/server/config/context.js").Principal;
			actor?: import("#questpie/server/modules/core/integrated/crdt/authority.js").AuthorityActor;
			queue?: any;
			email?: any;
			storage?: any;
			kv?: any;
			executor?: any;
			logger?: any;
			search?: any;
			realtime?: any;
			collections?: any;
			globals?: any;
			tables?: any;
			t?: any;
			services?: Record<string, any>;
			workflows?: any;
		}
	}
}

export interface AppContextBase extends Questpie.AppContextBase {}
