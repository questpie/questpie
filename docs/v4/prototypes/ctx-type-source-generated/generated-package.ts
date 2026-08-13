import {
	internalDefinitionFactories,
	type ApplicationContract,
	type Operation,
	type QueryFactory,
	type ReadCollection,
	type WriteCollection,
} from "./framework";

export interface AuditEvent {
	id: string;
	message: string;
}

interface PackageContract extends ApplicationContract {
	readData: {
		auditEvents: ReadCollection<AuditEvent, { id: string }>;
	};
	writeData: {
		auditEvents: WriteCollection<AuditEvent, { id: string }>;
	};
	queries: Record<never, never>;
	mutations: Record<never, never>;
	actions: {
		"acme.audit.deliver": Operation<AuditEvent, { accepted: true }>;
	};
	dispatch: Record<never, never>;
	jobs: Record<never, never>;
}

// A Package is checked against its own published, closed composition contract.
// It never imports the consuming application's `#questpie/app` contract.
export const defineQuery: QueryFactory<PackageContract> =
	internalDefinitionFactories.defineQuery;
