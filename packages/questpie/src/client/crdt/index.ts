import type { CrdtClientAPI } from "../../server/modules/core/integrated/crdt/types.js";
import { CrdtClientCoordinator } from "./coordinator.js";
import { CrdtClientDocument } from "./document.js";
import type { CrdtClientHostConfig } from "./types.js";

type OwnerKind = "collection" | "global";

export function createCrdtClientAPI(
	host: CrdtClientHostConfig,
): CrdtClientAPI<any> {
	const coordinator = new CrdtClientCoordinator();
	const owners = (kind: OwnerKind) =>
		new Proxy(
			{},
			{
				get(_target, ownerKey) {
					if (typeof ownerKey !== "string") return undefined;
					return {
						document: (locator?: { id: string | number }) =>
							new CrdtClientDocument(
								host,
								kind,
								ownerKey,
								locator,
								undefined,
								coordinator,
							) as unknown,
					};
				},
			},
		);
	return {
		collections: owners("collection"),
		globals: owners("global"),
	} as CrdtClientAPI<any>;
}

export type {
	CrdtTextAnchorInput,
	CrdtTextAnchorResolution,
	CrdtTextAnchorToken,
} from "../../shared/crdt-anchor.js";
export * from "./types.js";
