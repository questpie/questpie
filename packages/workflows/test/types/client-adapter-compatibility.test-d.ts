import { expectTypeOf } from "bun:test";

import type { WorkflowClientDeps } from "../../src/server/client.js";

type LegacyClientDeps = {
	[K in "instances" | "steps" | "events"]: Omit<
		WorkflowClientDeps[K],
		"updateMany"
	>;
} & Pick<WorkflowClientDeps, "publishExecute">;

expectTypeOf<LegacyClientDeps>().toMatchTypeOf<WorkflowClientDeps>();
