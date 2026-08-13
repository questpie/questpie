import {
	internalDefinitionFactories,
	type ActionFactory,
	type ApplicationContract,
	type JobFactory,
	type MutationFactory,
	type Operation,
	type QueryFactory,
	type QueryHandler as BaseQueryHandler,
	type ReactionFactory,
	type ReadCollection,
	type RouteFactory,
	type WriteCollection,
} from "./framework";

export interface Message {
	id: string;
	companyId: string;
	body: string;
}

export interface Company {
	id: string;
	name: string;
}

interface AppContract extends ApplicationContract {
	readData: {
		companies: ReadCollection<Company, { id: string }>;
		messages: ReadCollection<Message, { id: string }>;
	};
	writeData: {
		companies: WriteCollection<Company, { id: string }>;
		messages: WriteCollection<Message, { id: string }>;
	};
	queries: {
		"companies.summary": Operation<{ companyId: string }, { name: string }>;
		"companies.importedCheck": Operation<
			{ companyId: string },
			{ found: boolean }
		>;
	};
	mutations: {
		"messages.rename": Operation<{ id: string; body: string }, Message | null>;
	};
	actions: {
		"delivery.send": Operation<{ body: string }, { providerId: string }>;
	};
	dispatch: {
		messageSubmitted: Operation<
			{ messageId: string },
			{ dispatchId: string; runId: string }
		>;
	};
	jobs: {
		companyDigest: {
			dispatch: Operation<{ companyId: string }, { runId: string }>;
		};
	};
}

// The real generated module binds these types to compiler-owned factory values.
// It is not an application registry and contains no discovered runtime table.
export const defineQuery: QueryFactory<AppContract> =
	internalDefinitionFactories.defineQuery;
export const defineMutation: MutationFactory<AppContract> =
	internalDefinitionFactories.defineMutation;
export const defineReaction: ReactionFactory<AppContract> =
	internalDefinitionFactories.defineReaction;
export const defineJob: JobFactory<AppContract> =
	internalDefinitionFactories.defineJob;
export const defineAction: ActionFactory<AppContract> =
	internalDefinitionFactories.defineAction;
export const defineRoute: RouteFactory<AppContract> =
	internalDefinitionFactories.defineRoute;

export type QueryHandler<InputCodec extends import("./framework").Codec<unknown>> =
	BaseQueryHandler<AppContract, InputCodec>;
