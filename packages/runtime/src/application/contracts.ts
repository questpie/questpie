import type {
	ContextDefinition,
	ContextInputOf,
	Principal,
	ServiceDefinition,
	ServiceDependencyMap,
	ServiceEffect,
	ServiceInstance,
} from "questpie";

import type { RouteExecutionScope, RuntimeProgram } from "../execution";
import type { MutationInvoker } from "../mutation";
import type { RuntimeArtifactsV1 } from "./artifacts";
import type {
	LiveQueryCoordinator,
	RealtimeCarrierObservedPlan,
} from "./realtime";
import type { RuntimeRealtimeFactory } from "./runtime-realtime";

type MaybePromise<Value> = Value | Promise<Value>;

export interface RuntimeApplicationProgram<
	Context extends ContextDefinition,
	OperationView,
	ExecutionView = OperationView,
> extends RuntimeProgram<Context, OperationView> {
	readonly projectExecution?: RuntimeProgram<Context, ExecutionView>["project"];
	readonly projectMutation?: (
		scope: Parameters<RuntimeProgram<Context, OperationView>["project"]>[0],
	) => MaybePromise<MutationInvoker<OperationView>>;
	readonly invokeAction?: (
		input: Readonly<{
			identity: string;
			input: unknown;
			effectKey: string;
			callId: string;
			timeoutMilliseconds?: number;
			execution: ExecutionView;
			operations: RuntimeOperations;
		}>,
	) => MaybePromise<unknown>;
	readonly resolvePrincipal: (
		request: Request,
	) => MaybePromise<Principal | null>;
	readonly verifyReadiness?: (
		artifacts: RuntimeArtifactsV1,
	) => MaybePromise<void>;
	readonly onLiveQueryObserved?: (
		input: RealtimeCarrierObservedPlan,
	) => MaybePromise<void>;
	readonly liveQueryCoordinator?: LiveQueryCoordinator;
	readonly createRealtime?: RuntimeRealtimeFactory<ContextInputOf<Context>>;
}

export interface RuntimeOperations {
	invoke(
		operation: string,
		input: unknown,
		options?: Readonly<{
			callId?: string;
			signal?: AbortSignal;
			deadline?: number;
		}>,
	): Promise<unknown>;
}

export interface RuntimeApplication<Input, ExecutionView> {
	applicationService<
		Definition extends ServiceDefinition<
			string,
			"application",
			ServiceEffect,
			ServiceDependencyMap,
			unknown
		>,
	>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Input;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (
			scope: RuntimeOperations & Readonly<{ execution: ExecutionView }>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	route<Result>(
		input: Readonly<{
			principal: Principal;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (
			scope: RouteExecutionScope<
				Input,
				RuntimeOperations & Readonly<{ execution: ExecutionView }>
			>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}
