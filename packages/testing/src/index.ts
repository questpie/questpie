import type { RuntimeConfig } from "questpie/types";

/** A generated, singleton-free QUESTPIE application factory. */
export interface GeneratedAppFactory<TApp, TSession> {
	(runtime: RuntimeConfig): Promise<TApp>;
	readonly "~types"?: { session: TSession };
}
