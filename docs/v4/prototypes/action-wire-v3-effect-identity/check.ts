import { strict as assert } from "node:assert";

import {
	ActionPostDispatchResourceLimit,
	ActionOutcomeAmbiguous,
	admitOperationRequest,
	assertFrameworkOwnedOutcomeNondisclosure,
	createActionHarness,
	deriveDurableEffectIdentity,
	deriveEffectIdentity,
	isEffectKey,
	projectWireV3,
	signWireV3ForHostile,
	validateWireV3,
} from "./contract";
import retainedWireV2 from "./retained-wire-v2.json";
import wireV3Extension from "./wire-v3.json";

const scope = Object.freeze({
	application: "application:collaboration",
	tenant: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	principal: Object.freeze({
		kind: "user",
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	}),
	action: "action:delivery.publish",
	effectKey: "provider-request-2026-08-24-0001",
});

assert.equal(
	deriveEffectIdentity(scope),
	"6a58264b-7e1b-58db-abfa-b46e3cd5cd7f",
);
assert.notEqual(
	deriveDurableEffectIdentity(
		"collaboration",
		"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		"deliver",
	),
	"64a789a4-c319-5d2b-ac27-520d9808a941",
	"raw application names must not alias the production durable vector",
);
assert.equal(
	deriveDurableEffectIdentity(
		"application:collaboration",
		"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		"deliver",
	),
	"64a789a4-c319-5d2b-ac27-520d9808a941",
	"existing durable UUID vector changed",
);
assert.notEqual(
	deriveDurableEffectIdentity(
		"application:collaboration",
		"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		"deliver",
	),
	deriveEffectIdentity({
		...scope,
		effectKey: "deliver",
	}),
	"durable and ordinary Action derivation domains collided",
);
const changedInput = { ...scope, input: { body: "changed" } };
const originalInput = { ...scope, input: { body: "original" } };
assert.equal(
	deriveEffectIdentity(changedInput),
	deriveEffectIdentity(originalInput),
	"domain input must not alter Effect Identity",
);
const stableMaterial = { ...scope, effectKey: "stable" };
const changedCallId = { ...stableMaterial, callId: "changed" };
assert.equal(
	deriveEffectIdentity(stableMaterial),
	deriveEffectIdentity(changedCallId),
	"Mutation callId/correlation must not alter Effect Identity",
);
assert.throws(
	() =>
		deriveEffectIdentity({ ...scope, application: "collaboration" as never }),
	/canonical application Resource Identity/,
);
assert.throws(
	() => deriveEffectIdentity({ ...scope, action: "delivery.publish" as never }),
	/canonical action Resource Identity/,
);
assert.equal(
	deriveEffectIdentity({
		...scope,
		tenant: "tenant-alpha",
		principal: { kind: "anonymous", id: "anonymous" },
		action: "action:message.recordDelivery",
	}),
	"68a40904-4644-59cf-a9a5-1268f8fbc071",
);
assert.equal(
	deriveEffectIdentity({
		...scope,
		tenant: "tenant-alpha",
		principal: { kind: "service", id: "mailer/primary" },
		action: "action:messagePublished",
	}),
	"177813d8-80b2-55aa-a13a-c966aaa4d3be",
);

const wireV3 = projectWireV3(retainedWireV2, wireV3Extension);
const validated = validateWireV3(wireV3, retainedWireV2, wireV3Extension);
assert.equal(
	validated.digest,
	"f25f10a361faf30faac1106fe1feb87516458a1a700ace022a56017d854f6c98",
);
for (const mutate of [
	(wire: Record<string, unknown>) => (wire.compatibility = { destroyed: true }),
	(wire: Record<string, unknown>) => (wire.requestKeys = ["destroyed"]),
	(wire: Record<string, unknown>) =>
		(wire.actionRequestKeys = [...(wire.actionRequestKeys as string[])].filter(
			(key) => key !== "effectKey",
		)),
	(wire: Record<string, unknown>) =>
		(wire.effectKey = {
			...(wire.effectKey as object),
			defaultWhenAbsent: "random",
		}),
	(wire: Record<string, unknown>) => (wire.extra = true),
	(wire: Record<string, unknown>) =>
		((wire.operations as Record<string, unknown>[])[0]!.declaredErrors = {
			forged: true,
		}),
	(wire: Record<string, unknown>) =>
		(wire.operations = [...(wire.operations as unknown[])].toReversed()),
	(wire: Record<string, unknown>) =>
		(wire.actionFailures = [...(wire.actionFailures as string[])].toReversed()),
]) {
	const hostile = structuredClone(wireV3) as Record<string, unknown>;
	mutate(hostile);
	assert.throws(
		() =>
			validateWireV3(
				signWireV3ForHostile(hostile),
				retainedWireV2,
				wireV3Extension,
			),
		/invalid|changed|exact/,
		"a recomputed self-hash must not authorize semantic mutation",
	);
}
assert.deepEqual(
	(wireV3.operations as readonly Readonly<{ identity: string }>[]).map(
		({ identity }) => identity,
	),
	[
		"action:delivery.publish",
		"mutation:message.publish",
		"query:messages.page",
	],
);
assert.deepEqual(wireV3.actionFailures, [
	"ACTION_OUTCOME_AMBIGUOUS",
	"APPLICATION_MISMATCH",
	"CLIENT_OUTDATED",
	"COMMITTED_RESULT_UNAVAILABLE",
	"DEADLINE_EXCEEDED",
	"INTERNAL",
	"NOT_FOUND",
	"PROTOCOL_UNSUPPORTED",
	"RESOURCE_LIMIT",
	"RUNTIME_UNAVAILABLE",
]);

for (const invalid of [
	undefined,
	"",
	"e\u0301",
	"x\0y",
	"\ud800",
	"x".repeat(257),
	"😀".repeat(257),
])
	assert.equal(
		isEffectKey(invalid),
		false,
		`invalid effectKey accepted: ${String(invalid)}`,
	);
assert.equal(isEffectKey("x".repeat(256)), true);
assert.equal(isEffectKey("é"), true);
assert.equal(isEffectKey("😀".repeat(256)), true);

const exactActionRequest = Object.freeze({
	application: scope.application,
	callId: "call:negotiation",
	clientContractDigest: retainedWireV2.clientContractDigest,
	context: {},
	effectKey: scope.effectKey,
	input: {},
	operation: scope.action,
	protocol: retainedWireV2.protocol,
	timeoutMilliseconds: 5_000,
	wireDigest: wireV3.digest,
});
for (const version of [1, 2] as const) {
	const entered = { context: 0, service: 0, handler: 0 };
	assert.equal(
		admitOperationRequest({
			version,
			operation: scope.action,
			request: exactActionRequest,
			wireV3,
			enterContext: () => (entered.context += 1),
			createService: () => (entered.service += 1),
			enterHandler: () => (entered.handler += 1),
		}),
		"CLIENT_OUTDATED",
	);
	assert.deepEqual(entered, { context: 0, service: 0, handler: 0 });
}
for (const retained of [
	{ version: 1 as const, operation: "query:messages.page", accepted: true },
	{
		version: 1 as const,
		operation: "mutation:message.publish",
		accepted: false,
	},
	{ version: 2 as const, operation: "query:messages.page", accepted: true },
	{
		version: 2 as const,
		operation: "mutation:message.publish",
		accepted: true,
	},
]) {
	const { effectKey: _effectKey, ...ordinaryRequest } = exactActionRequest;
	const entered = { context: 0, service: 0, handler: 0 };
	const disposition = admitOperationRequest({
		version: retained.version,
		operation: retained.operation,
		request: { ...ordinaryRequest, operation: retained.operation },
		wireV3,
		enterContext: () => (entered.context += 1),
		createService: () => (entered.service += 1),
		enterHandler: () => (entered.handler += 1),
	});
	assert.equal(disposition, retained.accepted ? "accepted" : "CLIENT_OUTDATED");
	assert.deepEqual(
		entered,
		retained.accepted
			? { context: 1, service: 1, handler: 1 }
			: { context: 0, service: 0, handler: 0 },
	);
}
for (const version of [1, 2] as const) {
	const { effectKey: _effectKey, ...retainedShape } = exactActionRequest;
	const entered = { context: 0, service: 0, handler: 0 };
	assert.equal(
		admitOperationRequest({
			version,
			operation: "query:messages.page",
			request: retainedShape,
			wireV3,
			enterContext: () => (entered.context += 1),
			createService: () => (entered.service += 1),
			enterHandler: () => (entered.handler += 1),
		}),
		"CLIENT_OUTDATED",
		"a retained selected Query must not admit a request-authored Action",
	);
	assert.deepEqual(entered, { context: 0, service: 0, handler: 0 });
}
{
	const entered = { context: 0, service: 0, handler: 0 };
	assert.throws(
		() =>
			admitOperationRequest({
				version: 3,
				operation: "query:messages.page",
				request: exactActionRequest,
				wireV3,
				enterContext: () => (entered.context += 1),
				createService: () => (entered.service += 1),
				enterHandler: () => (entered.handler += 1),
			}),
		/does not match the selected operation/,
	);
	assert.deepEqual(entered, { context: 0, service: 0, handler: 0 });
}
for (const request of [
	(({ effectKey: _effectKey, ...missing }) => missing)(exactActionRequest),
	{ ...exactActionRequest, extra: true },
])
	assert.throws(() =>
		admitOperationRequest({
			version: 3,
			operation: scope.action,
			request,
			wireV3,
			enterContext() {},
			createService() {},
			enterHandler() {},
		}),
	);

const validRejection = createActionHarness({ carrier: "network" });
await assert.rejects(
	validRejection.invoke({
		...scope,
		callId: "call:valid-pre-execution-rejection",
		input: {},
		provider: "preExecutionRejected",
	}),
	/CLIENT_OUTDATED/,
);
assert.equal(validRejection.providerCalls, 0);
assert.deepEqual(validRejection.observedEffectIds, []);
assert.deepEqual(validRejection.frames, [
	{ error: { code: "CLIENT_OUTDATED", retryable: false }, kind: "failure" },
]);

const direct = createActionHarness({ carrier: "direct" });
const network = createActionHarness({ carrier: "network" });
for (const harness of [direct, network]) {
	const result = await harness.invoke({
		...scope,
		callId: "call:publish:1",
		input: { effectKey: "domain-value-cannot-override", body: "hello" },
		provider: "accepted",
	});
	assert.deepEqual(result, { receipt: "provider:accepted" });
	assert.equal(harness.providerCalls, 1);
	assert.equal(harness.observedEffectIds[0], deriveEffectIdentity(scope));
}
assert.deepEqual(
	direct.frames,
	network.frames,
	"direct/network bytes diverged",
);
assert.deepEqual(
	direct.frameBytes,
	network.frameBytes,
	"direct/network frame bytes diverged",
);
for (const bytes of [...direct.frameBytes, ...network.frameBytes])
	assert.equal(
		bytes.includes(deriveEffectIdentity(scope)),
		false,
		"effect.id leaked to wire",
	);

const effectId = deriveEffectIdentity(scope);
assert.throws(
	() =>
		assertFrameworkOwnedOutcomeNondisclosure(
			{
				error: {
					code: "INTERNAL",
					diagnostic: { nested: [`leaked:${effectId}`] },
				},
				kind: "failure",
			},
			[scope.effectKey, effectId],
		),
	/framework-owned outcome disclosed Effect material/,
);
for (const carrier of ["direct", "network"] as const) {
	const authoredResult = createActionHarness({ carrier });
	assert.deepEqual(
		await authoredResult.invoke({
			...scope,
			callId: `call:authored-result:${carrier}`,
			input: {},
			provider: "authoredResultDisclosure",
		}),
		{ receipt: effectId },
	);
	assert.equal(
		(authoredResult.frames[0] as Readonly<{ payload: { receipt: string } }>)
			.payload.receipt,
		effectId,
		"codec-authorized authored output must not be secretly scrubbed",
	);
	const authoredError = createActionHarness({ carrier });
	await assert.rejects(
		authoredError.invoke({
			...scope,
			callId: `call:authored-error:${carrier}`,
			input: {},
			provider: "authoredDeclaredErrorDisclosure",
		}),
		/provider.authoredDisclosure/,
	);
	assert.equal(
		(
			authoredError.frames[0] as Readonly<{
				error: { payload: { provider: string } };
			}>
		).error.payload.provider,
		effectId,
		"codec-authorized declared payload must remain application-owned",
	);
}

const deadlineLimits = {
	inputBytes: 1_024,
	resultBytes: 1_024,
	durationMilliseconds: 500,
} as const;
const directDeadline = createActionHarness({
	carrier: "direct",
	limits: deadlineLimits,
	rootRemainingMilliseconds: 300,
	callerMonotonicNow: () => 1_000,
	runtimeMonotonicNow: () => 4_000,
});
const networkDeadline = createActionHarness({
	carrier: "network",
	limits: deadlineLimits,
	rootRemainingMilliseconds: 300,
	callerMonotonicNow: () => 7_000,
	runtimeMonotonicNow: () => 9_000,
});
for (const harness of [directDeadline, networkDeadline])
	await harness.invoke({
		...scope,
		callId: "call:remaining-budget",
		input: {},
		provider: "accepted",
	});
assert.deepEqual(directDeadline.observedRemainingBudgets, [300]);
assert.deepEqual(networkDeadline.observedRemainingBudgets, [300]);
assert.deepEqual(directDeadline.observedLocalDeadlines, [4_300]);
assert.deepEqual(networkDeadline.observedLocalDeadlines, [9_300]);
assert.deepEqual(
	directDeadline.frameBytes,
	networkDeadline.frameBytes,
	"remaining-budget conversion changed direct/network outcome bytes",
);

for (const provider of [
	"rejected",
	"outcomeUnknown",
	"resultPayloadOverflow",
	"outcomeUnknownPayloadOverflow",
] as const) {
	const pair = [
		createActionHarness({ carrier: "direct" }),
		createActionHarness({ carrier: "network" }),
	];
	const errors: unknown[] = [];
	for (const harness of pair) {
		try {
			await harness.invoke({
				...scope,
				callId: `call:parity:${provider}`,
				input: { effectKey: "domain-does-not-own-identity" },
				provider,
			});
			assert.fail(`${provider} unexpectedly succeeded`);
		} catch (error) {
			errors.push(
				error instanceof ActionOutcomeAmbiguous
					? {
							code: error.code,
							payload: error.payload,
							retryable: error.retryable,
						}
					: error instanceof ActionPostDispatchResourceLimit
						? {
								code: error.code,
								phase: error.phase,
								retryable: error.retryable,
							}
						: error instanceof Error
							? { message: error.message }
							: error,
			);
		}
	}
	assert.deepEqual(errors[0], errors[1], `${provider} error parity diverged`);
	assert.deepEqual(
		pair[0]!.frameBytes,
		pair[1]!.frameBytes,
		`${provider} frame parity diverged`,
	);
	for (const harness of pair)
		for (const bytes of harness.frameBytes)
			assert.equal(
				bytes.includes(deriveEffectIdentity(scope)),
				false,
				`${provider} leaked effect.id`,
			);
}

const duplicate = createActionHarness({ carrier: "network" });
for (const callId of ["call:duplicate:1", "call:duplicate:2"]) {
	await duplicate.invoke({
		...scope,
		callId,
		input: { body: callId },
		provider: "accepted",
	});
}
assert.equal(duplicate.providerCalls, 2, "Runtime must not claim exactly-once");
assert.deepEqual(
	duplicate.observedEffectIds,
	[deriveEffectIdentity(scope), deriveEffectIdentity(scope)],
	"duplicate admission changed the stable provider-visible identity",
);

const beforeDispatch = createActionHarness({ carrier: "network" });
const ownedCancellation = Object.freeze({ code: "CALLER_CANCELLED" });
await assert.rejects(
	beforeDispatch.invoke({
		...scope,
		callId: "call:cancelled-before-dispatch",
		input: {},
		provider: "accepted",
		preDispatchCancellation: ownedCancellation,
	}),
	(error: unknown) => error === ownedCancellation,
);
assert.equal(beforeDispatch.providerCalls, 0);

const unknown = createActionHarness({ carrier: "network" });
await assert.rejects(
	unknown.invoke({
		...scope,
		callId: "call:publish:unknown",
		input: { body: "unknown" },
		provider: "outcomeUnknown",
	}),
	(error: unknown) =>
		error instanceof Error && error.message === "provider.outcomeUnknown",
);
assert.equal(unknown.providerCalls, 1);
assert.equal(unknown.automaticRetries, 0);

for (const failure of [
	"fetchRejected",
	"responseLost",
	"cancelledAfterDispatch",
	"malformedContentType",
	"invalidJson",
	"unknownFrame",
	"miscorrelatedFrame",
	"connectionTruncated",
] as const) {
	const ambiguous = createActionHarness({ carrier: "network" });
	await assert.rejects(
		ambiguous.invoke({
			...scope,
			callId: `call:publish:${failure}`,
			input: { body: failure },
			provider: failure,
		}),
		(error: unknown) =>
			error instanceof ActionOutcomeAmbiguous &&
			error.code === "ACTION_OUTCOME_AMBIGUOUS" &&
			error.retryable === false &&
			error.payload.callId === `call:publish:${failure}` &&
			error.payload.effectKey === scope.effectKey,
	);
	assert.equal(ambiguous.providerCalls, 1);
	assert.equal(ambiguous.automaticRetries, 0);
	assert.deepEqual(
		ambiguous.frames,
		[],
		"transport ambiguity fabricated a server frame",
	);
	assert.deepEqual(
		ambiguous.frameBytes,
		[],
		"transport ambiguity fabricated received bytes",
	);
}

for (const provider of [
	"resultPayloadOverflow",
	"outcomeUnknownPayloadOverflow",
] as const) {
	const overflow = createActionHarness({ carrier: "network" });
	await assert.rejects(
		overflow.invoke({
			...scope,
			callId: `call:publish:${provider}`,
			input: {},
			provider,
		}),
		(error: unknown) =>
			error instanceof ActionPostDispatchResourceLimit &&
			error.code === "RESOURCE_LIMIT" &&
			error.phase === "postHandler" &&
			error.retryable === false &&
			error.provesProviderNonacceptance === false &&
			error.replayAuthorized === false &&
			error.doesNotClassifyProviderOutcome === true,
	);
	assert.equal(overflow.providerCalls, 1);
	assert.equal(overflow.automaticRetries, 0);
}

console.log("Action Wire v3 proof: derivation, parity, ambiguity PASS");
