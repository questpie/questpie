/**
 * Generated-emission type tripwires.
 *
 * Guards two regressions found by the type-supremacy audit (crud spec F3 +
 * codegen spec F4). Both are silent failures: nothing in the framework or the
 * app errors when they regress — types just degrade everywhere. These
 * assertions turn the degradation into a compile error in this example's
 * `tsc --noEmit` run.
 *
 * 1. `AppCollections` must satisfy `Record<string, AnyCollectionOrBuilder>`.
 *    Module codegen must emit category maps as `type` aliases — interfaces
 *    have no implicit index signature, so the app-level intersection fails
 *    the constraint, the crud layer silently falls back to
 *    `Record<string, AnyCollectionOrBuilder>`, `GetCollection` resolves to
 *    `never`, and every `with`-populated relation types as `{}` app-wide.
 *
 * 2. `AppConfig` must keep literal collection/global keys (no
 *    `& Record<string, …>` index-signature poisoning), so phantom keys are
 *    rejected on `createClient<AppConfig>()` surfaces.
 */
import type { QuestpieClient } from "questpie/client";
import type { AnyCollectionOrBuilder } from "questpie/types";

import { app, type AppCollections, type AppConfig } from "#questpie";

type Expect<T extends true> = T;

// ── 1a. Record-constraint tripwire ─────────────────────────────────────────
// Fails if any module emits its collection map as an `interface` again (or
// anything else strips the implicit index signature from the aggregate).
type _CollectionsSatisfyRecord = Expect<
	AppCollections extends Record<string, AnyCollectionOrBuilder> ? true : false
>;

// ── 1b. with-populated relation resolves the target row, not `{}` ──────────
async function _withPopulatedRelationTripwire() {
	const order = await app.collections.productionOrders.findOne({
		with: { toy: true },
	});
	if (!order || !order.toy) return;
	// `{}` regression makes this line error (TS2339 on `.name`).
	const toyName: string = order.toy.name;
	void toyName;
}
void _withPopulatedRelationTripwire;

// ── 2. client surface rejects phantom keys ──────────────────────────────────
// The type reference itself also re-checks the `QuestpieApp` constraint
// (TS2344 here means AppConfig stopped satisfying the client SDK).
declare const client: QuestpieClient<AppConfig>;

void client.collections.toys;
// @ts-expect-error phantom collection keys must not exist on the client
void client.collections.definitelyNotACollection;

void client.globals.siteSettings;
// @ts-expect-error phantom global keys must not exist on the client
void client.globals.definitelyNotAGlobal;

// ── 3. execution contexts expose the AppWorkflows-typed client ──────────────
// Guards the `workflows: WorkflowClient<AppWorkflows>` emission: keys and
// payloads on trigger() must be checked (previously a blind client that
// accepted any name + any payload).
declare const wfCtx: Questpie.WorkflowContext;
async function _typedWorkflowsTripwire() {
	await wfCtx.workflows.trigger("production-order-plan", { orderId: "x" });
	// @ts-expect-error unknown workflow names must be rejected
	await wfCtx.workflows.trigger("does-not-exist", {});
	// @ts-expect-error wrong payload shapes must be rejected
	await wfCtx.workflows.trigger("production-order-plan", { wrong: true });

	// Typed execution-context members (previously `unknown`).
	wfCtx.logger.info("typed");
	void wfCtx.session?.user.id;
	await wfCtx.globals.siteSettings.get();
}
void _typedWorkflowsTripwire;

export {};
