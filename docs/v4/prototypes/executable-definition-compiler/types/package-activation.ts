import type {
	ApplicationContract,
	Operation,
	ReadCollection,
	WriteCollection,
} from "questpie";

import type { CurrentPackageContract } from "#questpie/package";

interface HostMessage {
	id: string;
	body: string;
}

interface WiderHostContract extends ApplicationContract {
	readData: CurrentPackageContract["readData"] & {
		messages: ReadCollection<HostMessage, { id: string }>;
	};
	writeData: CurrentPackageContract["writeData"] & {
		messages: WriteCollection<HostMessage, { id: string }>;
	};
	queries: CurrentPackageContract["queries"] & {
		"host.messages": Operation<{ id: string }, HostMessage | null>;
	};
	mutations: Record<never, never>;
	actions: Record<never, never>;
	dispatch: Record<never, never>;
	jobs: Record<never, never>;
}

type Assert<Condition extends true> = Condition;
type PackageDataActivatesIntoWiderHost = Assert<
	keyof CurrentPackageContract["readData"] extends keyof WiderHostContract["readData"]
		? true
		: false
>;
type HostOnlyDataDoesNotEnterPackage = Assert<
	"messages" extends keyof CurrentPackageContract["readData"] ? false : true
>;

export type PackageActivationProof =
	| PackageDataActivatesIntoWiderHost
	| HostOnlyDataDoesNotEnterPackage;
