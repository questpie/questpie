import { principal, type Principal } from "questpie";

import type { DurableActor } from "./rows";

/**
 * Every physical attempt rebuilds the caller Principal from the persisted
 * run-as references. Acceptance never persists a credential, a request, or a
 * resolved Context, so nothing here can outlive current Policy evidence.
 */
export function durablePrincipal(actor: DurableActor): Principal {
	if (actor.kind === "user") return principal.user({ id: actor.id });
	if (actor.kind === "service") return principal.service({ name: actor.id });
	return principal.anonymous();
}
