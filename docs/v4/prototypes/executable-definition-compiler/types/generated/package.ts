import {
	__definitionFactories,
	type ApplicationContract,
	type QueryFactory,
	type ReadCollection,
	type WriteCollection,
} from "../framework";

export interface AuditEvent {
	sequence: number;
	subject: string;
}

export interface CurrentPackageContract extends ApplicationContract {
	readData: {
		auditEvents: ReadCollection<AuditEvent, { sequence: number }>;
	};
	writeData: {
		auditEvents: WriteCollection<AuditEvent, { sequence: number }>;
	};
	queries: Record<never, never>;
	mutations: Record<never, never>;
	actions: Record<never, never>;
	dispatch: Record<never, never>;
	jobs: Record<never, never>;
}

export const defineQuery: QueryFactory<CurrentPackageContract> =
	__definitionFactories.defineQuery;
