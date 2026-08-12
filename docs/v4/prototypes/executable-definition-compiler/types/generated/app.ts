import {
	__definitionFactories,
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
} from "../framework";

export interface Company {
	id: string;
	name: string;
}

export interface Space {
	id: string;
	companyId: string;
	name: string;
}

export interface Channel {
	id: string;
	spaceId: string;
	name: string;
}

export interface Membership {
	companyId: string;
	principalId: string;
	role: "member" | "admin";
}

export interface Message {
	id: string;
	companyId: string;
	channelId: string;
	body: string;
	updatedAt: Date;
}

export interface MessageEvent {
	sequence: number;
	messageId: string;
	kind: "created" | "renamed";
}

export interface CurrentAppContract extends ApplicationContract {
	readData: {
		companies: ReadCollection<Company, { id: string }>;
		spaces: ReadCollection<Space, { id: string }>;
		channels: ReadCollection<Channel, { id: string }>;
		memberships: ReadCollection<
			Membership,
			{ companyId: string; principalId: string }
		>;
		messages: ReadCollection<Message, { id: string }>;
		messageEvents: ReadCollection<MessageEvent, { sequence: number }>;
	};
	writeData: {
		companies: WriteCollection<Company, { id: string }>;
		spaces: WriteCollection<Space, { id: string }>;
		channels: WriteCollection<Channel, { id: string }>;
		memberships: WriteCollection<
			Membership,
			{ companyId: string; principalId: string }
		>;
		messages: WriteCollection<Message, { id: string }>;
		messageEvents: WriteCollection<MessageEvent, { sequence: number }>;
	};
	queries: {
		"companies.summary": Operation<
			{ companyId: string },
			{ name: string } | null
		>;
		"companies.importedCheck": Operation<
			{ companyId: string },
			{ found: boolean }
		>;
		"messages.summary": Operation<
			{ id: string },
			{ id: string; body: string } | null
		>;
		"messages.list": Operation<
			{ first: number },
			ReadonlyArray<{ id: string; body: string }>
		>;
		"messages.get": Operation<
			{ id: string },
			{ id: string; body: string } | null
		>;
		"reports.companyDigest": Operation<
			{ companyId: string },
			{ name: string } | null
		>;
	};
	mutations: {
		"messages.rename": Operation<
			{ id: string; body: string },
			{ id: string; body: string; updatedAt: Date } | null
		>;
		"messages.create": Operation<
			{ body: string },
			{ id: string; body: string }
		>;
		"messages.update": Operation<
			{ id: string; body: string },
			{ id: string; body: string }
		>;
		"messages.delete": Operation<{ id: string }, { deleted: boolean }>;
	};
	actions: {
		"delivery.send": Operation<
			{ body: string; effectKey: string },
			{ providerId: string }
		>;
	};
	dispatch: {
		messageRenamed: Operation<
			{ messageId: string },
			{ dispatchId: string; runId: string }
		>;
	};
	jobs: {
		companyDigest: {
			dispatch: Operation<{ companyId: string }, { runId: string }>;
		};
	};
	reactions: {
		messageRenamed: Operation<
			{ messageId: string },
			| { kind: "unavailable" }
			| { kind: "sent"; providerId: string; attempt: number }
		>;
	};
	routes: {
		"delivery.webhook": Operation<Request, Response>;
	};
}

export const defineQuery: QueryFactory<CurrentAppContract> =
	__definitionFactories.defineQuery;
export const defineMutation: MutationFactory<CurrentAppContract> =
	__definitionFactories.defineMutation;
export const defineReaction: ReactionFactory<CurrentAppContract> =
	__definitionFactories.defineReaction;
export const defineJob: JobFactory<CurrentAppContract> =
	__definitionFactories.defineJob;
export const defineAction: ActionFactory<CurrentAppContract> =
	__definitionFactories.defineAction;
export const defineRoute: RouteFactory<CurrentAppContract> =
	__definitionFactories.defineRoute;

export type QueryHandler<InputCodec> = BaseQueryHandler<
	CurrentAppContract,
	InputCodec
>;
