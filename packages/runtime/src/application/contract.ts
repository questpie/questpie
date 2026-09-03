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
import type { RuntimeExecutionObservation } from "../observation";
import type { RuntimeArtifactsV1 } from "./artifacts";
import type {
	LiveQueryCoordinator,
	RealtimeCarrierObservedPlan,
} from "./realtime";
import type { RuntimeRealtimeFactory } from "./runtime-realtime";

export type MaybePromise<Value> = Value | Promise<Value>;

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
			onHandlerDispatch?(): void;
			execution: ExecutionView;
			operations: RuntimeOperations;
		}>,
	) => MaybePromise<unknown>;
	readonly resolvePrincipal: (
		request: Request,
		signal?: AbortSignal,
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
		input: ExecutionInput<Input>,
		use: ExecutionUse<ExecutionView, Result>,
	): Promise<Awaited<Result>>;
	workerExecution<Result>(
		input: ExecutionInput<Input>,
		around: WorkerExecutionAround<Result>,
		use: ExecutionUse<ExecutionView, Result>,
	): Promise<Awaited<Result>>;
	route<Result>(
		input: Readonly<{
			principal: Principal;
			signal?: AbortSignal;
			deadline?: number;
			entry?: "direct" | "fetch";
		}>,
		use: (
			scope: RouteExecutionScope<
				Input,
				RuntimeOperations & Readonly<{ execution: ExecutionView }>
			>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	observeRoute(
		request: Request,
		routeTemplate: string,
		use: () => Promise<
			Readonly<{
				outcome: "ok" | "framework_error" | "deadline";
				response: Response;
				signal: AbortSignal;
				finalize(): void;
				retainControl: boolean;
				abortOutcome(): "cancelled" | "deadline";
			}>
		>,
	): Promise<Response>;
	observeUnmatchedFetch(
		request: Request,
		use: () => Promise<Response>,
	): Promise<Response>;
	fetch(request: Request): Promise<Response>;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

export type ExecutionInput<Input> = Readonly<{
	principal: Principal;
	context: Input;
	signal?: AbortSignal;
	deadline?: number;
}>;

export type ExecutionUse<ExecutionView, Result> = (
	scope: RuntimeOperations & Readonly<{ execution: ExecutionView }>,
) => MaybePromise<Result>;

export type WorkerExecutionAround<Result> = (
	observation: RuntimeExecutionObservation | null,
	use: () => Promise<Result>,
) => MaybePromise<Result>;
