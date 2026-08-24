import type { Principal, ServiceDefinition } from "questpie";

import type {
	RuntimeActionBinding,
	RuntimeActionExecutor,
	RuntimeActionProjectionScope,
} from "../../packages/runtime/src/action";
import type { RuntimeExecutionScope } from "../../packages/runtime/src/execution";

type ActionContext = Readonly<{
	principal: Principal;
	signal: AbortSignal;
	deadline: number | null;
}>;

const binding = {
	identity: "action:delivery.send",
	admission: "authenticated",
	limits: {
		inputBytes: 1_024,
		resultBytes: 1_024,
		durationMilliseconds: 5_000,
	},
	input: { kind: "text" },
	output: { kind: "text" },
	declaredErrors: [],
	execute: ({ ctx, effect }) => {
		void ctx.principal;
		void ctx.signal;
		void ctx.deadline;
		void effect.id;
		// @ts-expect-error Action Context has no data facade.
		void ctx.data;
		// @ts-expect-error Action Context has no raw database.
		void ctx.database;
		// @ts-expect-error Action Context has no transaction facade.
		void ctx.transaction;
		// @ts-expect-error Action Context has no durable controls.
		void ctx.durable;
		// @ts-expect-error Action Context cannot elevate to System.
		void ctx.system;
		// @ts-expect-error Effect Identity is immutable handler metadata.
		effect.id = "replacement";
		return "ok";
	},
} satisfies RuntimeActionBinding<ActionContext>;

void binding;

function assertActionServiceProjection(
	projection: RuntimeActionProjectionScope,
	readService: ServiceDefinition<
		"read-only",
		"execution",
		"read",
		Readonly<Record<never, never>>,
		Readonly<{ read(): string }>
	>,
	applicationExternalService: ServiceDefinition<
		"application-external",
		"application",
		"external",
		Readonly<Record<never, never>>,
		Readonly<{ send(): void }>
	>,
): void {
	// @ts-expect-error Action projection admits only external-effect Services.
	void projection.service(readService);
	// @ts-expect-error Action terminal projection admits only execution Services.
	void projection.service(applicationExternalService);
}

void assertActionServiceProjection;

declare const executor: RuntimeActionExecutor;
declare const scope: RuntimeExecutionScope<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;
void executor.invoke("action:delivery.send", {
	scope,
	input: "hello",
	effectKey: "provider-request",
});
// @ts-expect-error Ordinary Action requires caller-stable effectKey material.
void executor.invoke("action:delivery.send", { scope, input: "hello" });
void executor.invoke("action:delivery.send", {
	scope,
	input: "hello",
	effectKey: "provider-request",
	// @ts-expect-error Caller cannot supply the final Effect Identity alias.
	effectId: "forged",
});
void executor.invoke("action:delivery.send", {
	scope,
	input: "hello",
	effectKey: "provider-request",
	callId: "direct-correlation",
	timeoutMilliseconds: 1_000,
});
// @ts-expect-error callId correlates a call but cannot replace Effect material.
void executor.invoke("action:delivery.send", {
	scope,
	input: "hello",
	callId: "mutation-alias",
});
