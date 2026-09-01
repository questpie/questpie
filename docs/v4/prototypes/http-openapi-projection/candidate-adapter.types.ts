import { createCandidateAdapter } from "./candidate-adapter";

const empty = { kind: "object", properties: {} } as const;
const adapter = createCandidateAdapter({
	application: "application:typing",
	clientContractDigest: "a".repeat(64),
	definitions: [
		{
			context: empty,
			execute: async () => ({ kind: "result", value: {} }),
			input: empty,
			kind: "query",
			name: "proof.query",
			output: empty,
		},
		{
			context: empty,
			execute: async () => ({ kind: "result", value: {} }),
			input: empty,
			kind: "mutation",
			name: "proof.mutation",
			output: empty,
		},
		{
			context: empty,
			execute: async () => ({ kind: "result", value: {} }),
			input: empty,
			kind: "action",
			name: "proof.action",
			output: empty,
		},
	],
	resolvePrincipal: () => "principal",
	wireDigest: "b".repeat(64),
});
const generated = adapter.client.withContext({});

generated.queries["proof.query"]!(
	{},
	{
		callId: "query-call",
		timeoutMilliseconds: 1_000,
	},
);
generated.mutations["proof.mutation"]!(
	{},
	{
		callId: "mutation-call",
		timeoutMilliseconds: 1_000,
	},
);
generated.actions["proof.action"]!(
	{},
	{
		callId: "action-call",
		effectKey: "provider-effect",
		timeoutMilliseconds: 1_000,
	},
);

// @ts-expect-error Query has no Effect carrier.
generated.queries["proof.query"]!({}, { effectKey: "forged" });
// @ts-expect-error Mutation has no Effect carrier.
generated.mutations["proof.mutation"]!({}, { effectKey: "forged" });
// @ts-expect-error Idempotency is Call Identity, not a second option spelling.
generated.mutations["proof.mutation"]!({}, { idempotencyKey: "duplicate" });
// @ts-expect-error Action requires its Effect carrier before dispatch.
generated.actions["proof.action"]!({});
// @ts-expect-error Action options cannot omit effectKey.
generated.actions["proof.action"]!({}, { callId: "missing-effect" });
generated.actions["proof.action"]!(
	{},
	{
		effectKey: "provider-effect",
		// @ts-expect-error Action has no Mutation Idempotency option.
		idempotencyKey: "duplicate",
	},
);
