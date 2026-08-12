import type { DirectPrincipal, PolicyDefinition } from "../framework";

export interface AppContextInput {
	readonly companyId: string;
}

export interface AppResolvedContext {
	readonly tenant: { readonly id: string };
	readonly values: {
		readonly selectedMembershipPrincipalId: string;
		readonly selectedMembershipScope: string;
		readonly selectedRole: "member" | "moderator" | "admin" | "owner";
	};
}

export interface MessagePageInput {
	readonly channelId: string;
	readonly first: number;
	readonly after: string | null;
}

export interface MessageResult {
	readonly id: string;
	readonly companyId: string;
	readonly channelId: string;
	readonly authorId: string;
	readonly body: string;
	readonly moderationNote?: string | null;
	readonly createdAt: Date;
}

export interface MessagePage {
	readonly nodes: ReadonlyArray<MessageResult>;
	readonly pageInfo: {
		readonly hasNextPage: boolean;
		readonly endCursor: string | null;
	};
}

export interface GeneratedOperations {
	readonly queries: {
		readonly "messages.page": (input: MessagePageInput) => Promise<MessagePage>;
		readonly "messages.get": (input: {
			readonly id: string;
		}) => Promise<MessageResult | null>;
	};
}

export interface RootExecution extends GeneratedOperations, AppResolvedContext {
	readonly principal: DirectPrincipal;
	readonly authority: { readonly kind: "ordinary" };
	readonly signal: AbortSignal;
	readonly deadline: Date;
}

export interface GeneratedApp {
	execution<Result>(
		options: {
			readonly principal: DirectPrincipal;
			readonly context: AppContextInput;
			readonly signal?: AbortSignal;
			readonly deadline?: Date;
		},
		callback: (execution: RootExecution) => Promise<Result>,
	): Promise<Result>;
	close(): Promise<void>;
}

export declare function createApp(options: {
	readonly postgres: { readonly url: string };
}): Promise<GeneratedApp>;

export type MessagePolicyIdentity = PolicyDefinition<
	"policy:messages.default",
	"collection:messages"
>;
