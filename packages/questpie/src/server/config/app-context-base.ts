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
			queue?: any;
			email?: any;
			storage?: any;
			kv?: any;
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
