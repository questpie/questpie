import type { AppForDefinitions } from "./framework";

type Message = {
	readonly id: string;
	readonly body: string;
};

type MessageRead = {
	get(args: {
		readonly key: { readonly id: string };
		readonly select: { readonly id: true; readonly body: true };
	}): Promise<Message | null>;
};

type MessageWrite = MessageRead & {
	create(args: {
		readonly input: { readonly body: string };
		readonly select: { readonly id: true; readonly body: true };
	}): Promise<Message>;
};

type ExecutionFacts = {
	readonly principal: { readonly id: string };
	readonly tenant: { readonly id: string };
	readonly signal: AbortSignal;
};

type QueryContext = ExecutionFacts & {
	readonly data: { readonly messages: MessageRead };
};

type MutationContext = ExecutionFacts & {
	readonly data: { readonly messages: MessageWrite };
	readonly dispatch: {
		messageSubmitted(input: { readonly messageId: string }): Promise<{
			readonly runId: string;
		}>;
	};
};

type ReactionContext = QueryContext & {
	readonly actions: {
		readonly "delivery.send": (input: {
			readonly messageId: string;
			readonly effectKey: string;
		}) => Promise<{ readonly providerId: string }>;
	};
};

type JobContext = ReactionContext;

type ActionContext = ExecutionFacts & {
	readonly queries: {
		readonly "messages.get": (input: {
			readonly messageId: string;
		}) => Promise<Message | null>;
	};
};

type RouteContext = ExecutionFacts & {
	readonly execution: <TResult>(
		input: { readonly companyId: string },
		callback: (app: {
			readonly mutations: {
				readonly "messages.create": (input: {
					readonly body: string;
				}) => Promise<Message>;
			};
		}) => Promise<TResult>,
	) => Promise<TResult>;
};

/** Candidate generated authoring projection, imported as a type only. */
export interface AppContract extends AppForDefinitions {
	readonly definitions: {
		readonly query: QueryContext;
		readonly mutation: MutationContext;
		readonly reaction: ReactionContext;
		readonly job: JobContext;
		readonly action: ActionContext;
		readonly route: RouteContext;
	};
}
