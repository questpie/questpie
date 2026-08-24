import type { Principal, ServiceDefinition } from "questpie";

import type {
	RuntimeActionBinding,
	RuntimeActionProjectionScope,
} from "../../packages/runtime/src/action";

type ActionContext = Readonly<{
	principal: Principal;
	signal: AbortSignal;
	deadline: number | null;
}>;

const binding = {
	identity: "action:delivery.send",
	admission: "authenticated",
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

declare const projection: RuntimeActionProjectionScope;
declare const readService: ServiceDefinition<
	"read-only",
	"execution",
	"read",
	Readonly<Record<never, never>>,
	Readonly<{ read(): string }>
>;
// @ts-expect-error Action projection admits only external-effect Services.
void projection.service(readService);
