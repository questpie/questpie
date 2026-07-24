import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import {
	evaluateQuestpieCrdtOwnerPolicy,
	loadQuestpieCrdtOwnerRecord,
} from "#questpie/server/modules/core/integrated/crdt/questpie-host-application.js";
import { service } from "#questpie/server/services/define-service.js";

export default service({
	namespace: null,
	lifecycle: "request",
	create: (ctx) => {
		const requestContext = ctx as CRUDContext & {
			app: typeof ctx.app;
			services: {
				crdtOperations?: NonNullable<typeof ctx.app.crdtOperations>;
			};
		};
		const operational = requestContext.services.crdtOperations;
		if (!operational) {
			return unavailableCrdt();
		}
		return operational.createRequestOperations({
			context: requestContext,
			authorize: async (owner, database) => {
				const human =
					requestContext.principal?.kind === "user" ||
					requestContext.principal?.kind === "oauth";
				const agent = requestContext.actor?.kind === "agent";
				if (requestContext.accessMode === "system" || (!human && !agent)) {
					return { ownerRead: false, ownerEdit: false, fields: {} };
				}
				const app = requestContext.app as unknown as Questpie<any>;
				const resolved =
					owner.kind === "collection"
						? {
								kind: "collection" as const,
								key: owner.registryKey,
								ownerKey: owner.ownerKey,
								id: decodeCollectionLocator(owner.locator),
								locator: owner.locator,
							}
						: {
								kind: "global" as const,
								key: owner.registryKey,
								ownerKey: owner.ownerKey,
								locator: owner.locator,
							};
				const record = await loadQuestpieCrdtOwnerRecord(
					app,
					resolved,
					database,
				);
				if (!record) {
					return { ownerRead: false, ownerEdit: false, fields: {} };
				}
				return evaluateQuestpieCrdtOwnerPolicy(
					app,
					resolved,
					record,
					requestContext,
					database,
				);
			},
		});
	},
});

function unavailableCrdt() {
	return Object.freeze({
		collections: Object.freeze({}),
		globals: Object.freeze({}),
		async withAuthorityMutation() {
			throw new Error("CRDT runtime is unavailable");
		},
	});
}

function decodeCollectionLocator(locator: string): string | number {
	const value: unknown = JSON.parse(locator);
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		value[0] !== "id" ||
		(value[1] !== "string" && value[1] !== "number") ||
		typeof value[2] !== value[1]
	) {
		throw new Error("CRDT collection locator is invalid");
	}
	return value[2];
}
