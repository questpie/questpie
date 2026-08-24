import { expect, test } from "bun:test";

import retainedWireV2 from "../../docs/v4/prototypes/action-wire-v3-effect-identity/retained-wire-v2.json";
import acceptedWireV3 from "../../docs/v4/prototypes/action-wire-v3-effect-identity/wire-v3.json";
import { digest } from "../../packages/compiler/src/canonical";
import { projectOperationWireV3 } from "../../packages/compiler/src/runtime/operation-wire-v3";
import {
	negotiateOperationWireV3,
	validateOperationWireV3,
} from "../../packages/runtime/src/application/wire-v3-artifact";

const actionOperation = acceptedWireV3.actionOperation;

function project() {
	return projectOperationWireV3({
		retainedWireV2,
		actionOperation,
	});
}

function signed(
	value: Readonly<Record<string, unknown>>,
	domain = "questpie-operation-wire-v3",
) {
	const unsigned = { ...value };
	delete unsigned.digest;
	return {
		...unsigned,
		digest: digest(domain, unsigned),
	};
}

function resignRetained(change: Readonly<Record<string, unknown>>) {
	const changed = { ...retainedWireV2, ...change };
	const compatibility =
		changed.compatibility as typeof retainedWireV2.compatibility;
	const {
		callIdentity: _callIdentity,
		committedResultUnavailable: _committed,
		compatibility: _compatibility,
		digest: _digest,
		failureDetails: _failureDetails,
		resultKinds: _resultKinds,
		transactionIdentity: _transactionIdentity,
		...shared
	} = changed;
	const siblingV1 = {
		...shared,
		version: 1,
		clientContractDigest: compatibility.clientContractDigest,
		failures: changed.failures.filter(
			(code) => code !== "COMMITTED_RESULT_UNAVAILABLE",
		),
	};
	return signed(
		{
			...changed,
			compatibility: {
				...compatibility,
				wireV1Digest: digest("questpie-operation-wire-v1", siblingV1),
			},
		},
		"questpie-operation-wire-v2",
	);
}

function legacyProject(
	retained: Readonly<Record<string, unknown>>,
	action: Readonly<Record<string, unknown>>,
) {
	const wire = project();
	return signed({
		...wire,
		...retained,
		version: 3,
		compatibility: {
			...(retained.compatibility as object),
			wireV2Digest: retained.digest,
			wireV2ActionExecution: "rejectBeforeContextServiceAndHandler",
			wireV2MutationExecution: "allowed",
			wireV2QueryExecution: "allowed",
		},
		operations: [
			...(retained.operations as readonly Readonly<Record<string, unknown>>[]),
			action,
		].sort((left, right) =>
			String(left.identity) < String(right.identity) ? -1 : 1,
		),
	});
}

function request(
	wire: Readonly<Record<string, unknown>>,
	operation = "action:delivery.publish",
) {
	return {
		application: "application:collaboration",
		callId: "call:wire-v3-private",
		clientContractDigest: retainedWireV2.clientContractDigest,
		context: {},
		effectKey: "provider-request-2026-08-24-0001",
		input: {},
		operation,
		protocol: retainedWireV2.protocol,
		timeoutMilliseconds: 5_000,
		wireDigest: wire.digest,
	};
}

function ordinaryRequest(
	wire: Readonly<Record<string, unknown>>,
	operation: string,
) {
	const { effectKey: _effectKey, ...ordinary } = request(wire, operation);
	return ordinary;
}

test("private projector reproduces the accepted additive Wire v3 without mutating v2", () => {
	const before = structuredClone(retainedWireV2);
	const wire = project();
	const { actionOperation: _actionOperation, ...acceptedExtension } =
		acceptedWireV3;

	for (const [key, value] of Object.entries(acceptedExtension))
		expect(wire[key]).toEqual(value);
	expect(wire.digest).toBe(
		"c7596e3eef673d11381f9c9c9a25f81308084dd0054b91cfa8ddf9afe45457a4",
	);
	expect(retainedWireV2).toEqual(before);
	expect(
		(wire.operations as readonly Readonly<{ identity: string }>[]).map(
			({ identity }) => identity,
		),
	).toEqual([
		"action:delivery.publish",
		"mutation:message.publish",
		"query:messages.page",
	]);
});

test("projects and validates a canonical multi-Action inventory without changing the one-Action digest", () => {
	const single = project();
	const second = { ...actionOperation, identity: "action:delivery.retry" };
	const wire = projectOperationWireV3({
		retainedWireV2,
		actionOperations: [second, actionOperation],
	});
	expect(project().digest).toBe(single.digest);
	expect(
		(wire.operations as readonly Readonly<{ identity: string }>[]).map(
			({ identity }) => identity,
		),
	).toEqual([
		"action:delivery.publish",
		"action:delivery.retry",
		"mutation:message.publish",
		"query:messages.page",
	]);
	expect(
		validateOperationWireV3({
			wire,
			retainedWireV2,
			actionOperations: [actionOperation, second],
		}).digest,
	).toBe(wire.digest);
	expect(() =>
		projectOperationWireV3({
			retainedWireV2,
			actionOperations: [actionOperation, actionOperation],
		}),
	).toThrow(/duplicated/);
});

test("private projector rejects invalid retained pairs, grammar, and ordering", () => {
	for (const retained of [
		{ ...retainedWireV2, digest: "0".repeat(64) },
		{
			...retainedWireV2,
			compatibility: {
				...retainedWireV2.compatibility,
				wireV1Digest: "0".repeat(64),
			},
		},
		resignRetained({
			operations: [...retainedWireV2.operations].toReversed(),
		}),
	] as const)
		expect(() =>
			projectOperationWireV3({ retainedWireV2: retained, actionOperation }),
		).toThrow();

	for (const identity of [
		"delivery.publish",
		"mutation:delivery.publish",
		"action:Bad",
		"action:bad-name",
		"action:x..y",
		"action:x.then",
		`action:a${"A".repeat(63)}`,
	] as const)
		expect(() =>
			projectOperationWireV3({
				retainedWireV2,
				actionOperation: { ...actionOperation, identity },
			}),
		).toThrow(/Action operation identity/);
});

test("producer independently rejects re-signed retained semantics and malformed Action contracts", () => {
	const hostileRetained = resignRetained({
		protocol: { name: "hostile.operation", version: 1 },
	});
	const hostileRetainedCodec = resignRetained({
		operations: retainedWireV2.operations.map((operation, index) =>
			index === 0 ? { ...operation, input: {} } : operation,
		),
	});
	for (const [retained, pattern] of [
		[hostileRetained, /protocol/],
		[hostileRetainedCodec, /codec/],
	] as const)
		expect(() =>
			projectOperationWireV3({
				retainedWireV2: retained,
				actionOperation,
			}),
		).toThrow(pattern);

	for (const malformed of [
		{ ...actionOperation, input: {} },
		{
			...actionOperation,
			declaredErrors: {
				bad: { code: "BAD", payload: null, status: 200 },
			},
		},
	] as const)
		expect(() =>
			projectOperationWireV3({
				retainedWireV2,
				actionOperation: malformed,
			}),
		).toThrow();
});

test("consumer independently rejects re-signed caller-supplied semantic objects", () => {
	const hostileRetained = resignRetained({
		protocol: { name: "hostile.operation", version: 1 },
	});
	const hostileRetainedCodec = resignRetained({
		operations: retainedWireV2.operations.map((operation, index) =>
			index === 0 ? { ...operation, input: {} } : operation,
		),
	});
	for (const [retained, pattern] of [
		[hostileRetained, /protocol/],
		[hostileRetainedCodec, /codec/],
	] as const)
		expect(() =>
			validateOperationWireV3({
				wire: legacyProject(retained, actionOperation),
				retainedWireV2: retained,
				actionOperation,
			}),
		).toThrow(pattern);

	for (const malformedAction of [
		{ ...actionOperation, input: {} },
		{
			...actionOperation,
			declaredErrors: {
				bad: { code: "BAD", payload: null, status: 200 },
			},
		},
	] as const)
		expect(() =>
			validateOperationWireV3({
				wire: legacyProject(retainedWireV2, malformedAction),
				retainedWireV2,
				actionOperation: malformedAction,
			}),
		).toThrow();
});

test("producer and consumer treat re-signed response object order canonically", () => {
	const reordered = resignRetained({
		responseKeys: Object.fromEntries(
			Object.entries(retainedWireV2.responseKeys).toReversed(),
		),
	});
	const wire = projectOperationWireV3({
		retainedWireV2: reordered,
		actionOperation,
	});
	expect(wire.digest).toBe(project().digest);
	expect(
		validateOperationWireV3({
			wire,
			retainedWireV2: reordered,
			actionOperation,
		}).digest,
	).toBe(wire.digest);

	const reorderedArray = resignRetained({
		responseKeys: {
			...retainedWireV2.responseKeys,
			result: [...retainedWireV2.responseKeys.result].toReversed(),
		},
	});
	expect(() =>
		projectOperationWireV3({
			retainedWireV2: reorderedArray,
			actionOperation,
		}),
	).toThrow(/response keys/);
	expect(() =>
		validateOperationWireV3({
			wire: legacyProject(reorderedArray, actionOperation),
			retainedWireV2: reorderedArray,
			actionOperation,
		}),
	).toThrow(/response keys/);
});

test("Runtime validator refuses recomputed semantic drift", () => {
	const wire = project();
	expect(
		validateOperationWireV3({ wire, retainedWireV2, actionOperation }),
	).toEqual({
		digest: wire.digest,
		pairs: {
			currentV3: {
				clientContractDigest: retainedWireV2.clientContractDigest,
				wireDigest: wire.digest,
			},
			retainedV2: {
				clientContractDigest: retainedWireV2.clientContractDigest,
				wireDigest: retainedWireV2.digest,
			},
			retainedV1: {
				clientContractDigest: retainedWireV2.compatibility.clientContractDigest,
				wireDigest: retainedWireV2.compatibility.wireV1Digest,
			},
		},
	});

	for (const mutate of [
		(value: Record<string, unknown>) => (value.extra = true),
		(value: Record<string, unknown>) => (value.requestKeys = ["destroyed"]),
		(value: Record<string, unknown>) =>
			(value.operations = [
				...(value.operations as readonly unknown[]),
			].toReversed()),
		(value: Record<string, unknown>) =>
			(value.actionFailures = [
				...(value.actionFailures as readonly unknown[]),
			].toReversed()),
		(value: Record<string, unknown>) =>
			(value.actionOutcomeAmbiguous = {
				...(value.actionOutcomeAmbiguous as object),
				payload: ["callId", "effectKey"],
			}),
	] as const) {
		const hostile = structuredClone(wire) as Record<string, unknown>;
		mutate(hostile);
		expect(() =>
			validateOperationWireV3({
				wire: signed(hostile),
				retainedWireV2,
				actionOperation,
			}),
		).toThrow();
	}
});

test("negotiation preserves v1/v2 compatibility and rejects Action before work", () => {
	const wire = project();
	const entered = { context: 0, service: 0, handler: 0 };
	const enter = {
		enterContext: () => (entered.context += 1),
		createService: () => (entered.service += 1),
		enterHandler: () => (entered.handler += 1),
	};
	const pair = (wireDigest: string) => ({
		clientContractDigest: retainedWireV2.clientContractDigest,
		wireDigest,
	});

	for (const wireDigest of [
		retainedWireV2.compatibility.wireV1Digest,
		retainedWireV2.digest,
	]) {
		expect(
			negotiateOperationWireV3({
				wire,
				retainedWireV2,
				actionOperation,
				selectedOperation: "action:delivery.publish",
				request: {
					...ordinaryRequest(wire, "action:delivery.publish"),
					...pair(wireDigest),
				},
				...enter,
			}),
		).toBe("CLIENT_OUTDATED");
	}
	expect(entered).toEqual({ context: 0, service: 0, handler: 0 });

	for (const retained of [
		{
			wireDigest: retainedWireV2.compatibility.wireV1Digest,
			operation: "query:messages.page",
			accepted: true,
		},
		{
			wireDigest: retainedWireV2.compatibility.wireV1Digest,
			operation: "mutation:message.publish",
			accepted: false,
		},
		{
			wireDigest: retainedWireV2.digest,
			operation: "query:messages.page",
			accepted: true,
		},
		{
			wireDigest: retainedWireV2.digest,
			operation: "mutation:message.publish",
			accepted: true,
		},
	] as const) {
		const before = { ...entered };
		expect(
			negotiateOperationWireV3({
				wire,
				retainedWireV2,
				actionOperation,
				selectedOperation: retained.operation,
				request: {
					...ordinaryRequest(wire, retained.operation),
					...pair(retained.wireDigest),
				},
				...enter,
			}),
		).toBe(retained.accepted ? "accepted" : "CLIENT_OUTDATED");
		expect({
			context: entered.context - before.context,
			service: entered.service - before.service,
			handler: entered.handler - before.handler,
		}).toEqual(
			retained.accepted
				? { context: 1, service: 1, handler: 1 }
				: { context: 0, service: 0, handler: 0 },
		);
	}
});

test("v3 negotiation enforces selected operation and exact kind-specific keys", () => {
	const wire = project();
	const entered = { context: 0, service: 0, handler: 0 };
	const base = {
		wire,
		retainedWireV2,
		actionOperation,
		enterContext: () => (entered.context += 1),
		createService: () => (entered.service += 1),
		enterHandler: () => (entered.handler += 1),
	};

	expect(
		negotiateOperationWireV3({
			...base,
			selectedOperation: "action:delivery.publish",
			request: request(wire),
		}),
	).toBe("accepted");
	expect(entered).toEqual({ context: 1, service: 1, handler: 1 });

	for (const invalid of [
		((value) => {
			const { effectKey: _effectKey, ...missing } = value;
			return missing;
		})(request(wire)),
		{ ...request(wire), extra: true },
	])
		expect(() =>
			negotiateOperationWireV3({
				...base,
				selectedOperation: "action:delivery.publish",
				request: invalid,
			}),
		).toThrow(/request.*keys/i);

	expect(() =>
		negotiateOperationWireV3({
			...base,
			selectedOperation: "query:messages.page",
			request: request(wire),
		}),
	).toThrow(/does not match/);
	expect(entered).toEqual({ context: 1, service: 1, handler: 1 });
});

test("negotiation rejects hostile pairs and mismatches before work", () => {
	const wire = project();
	const entered = { context: 0, service: 0, handler: 0 };
	const base = {
		wire,
		retainedWireV2,
		actionOperation,
		enterContext: () => (entered.context += 1),
		createService: () => (entered.service += 1),
		enterHandler: () => (entered.handler += 1),
	};
	const noWork = () =>
		expect(entered).toEqual({ context: 0, service: 0, handler: 0 });

	expect(
		negotiateOperationWireV3({
			...base,
			selectedOperation: "query:messages.page",
			request: {
				...ordinaryRequest(wire, "query:messages.page"),
				wireDigest: "0".repeat(64),
			},
		}),
	).toBe("CLIENT_OUTDATED");
	noWork();

	for (const [selectedOperation, requestedOperation] of [
		["action:delivery.publish", "query:messages.page"],
		["query:messages.page", "action:delivery.publish"],
	] as const) {
		expect(
			negotiateOperationWireV3({
				...base,
				selectedOperation,
				request: {
					...ordinaryRequest(wire, requestedOperation),
					wireDigest: retainedWireV2.digest,
				},
			}),
		).toBe("CLIENT_OUTDATED");
		noWork();
	}

	expect(() =>
		negotiateOperationWireV3({
			...base,
			selectedOperation: "query:messages.page",
			request: {
				...ordinaryRequest(wire, "mutation:message.publish"),
				wireDigest: retainedWireV2.digest,
			},
		}),
	).toThrow(/does not match/);
	noWork();
});

test("v3 negotiation validates ordinary requests and hostile identities before work", () => {
	const wire = project();
	const entered = { context: 0, service: 0, handler: 0 };
	const base = {
		wire,
		retainedWireV2,
		actionOperation,
		enterContext: () => (entered.context += 1),
		createService: () => (entered.service += 1),
		enterHandler: () => (entered.handler += 1),
	};

	for (const operation of [
		"query:messages.page",
		"mutation:message.publish",
	] as const)
		expect(
			negotiateOperationWireV3({
				...base,
				selectedOperation: operation,
				request: ordinaryRequest(wire, operation),
			}),
		).toBe("accepted");
	expect(entered).toEqual({ context: 2, service: 2, handler: 2 });

	for (const hostile of [
		{ ...request(wire), callId: "" },
		{ ...request(wire), effectKey: "" },
		{ ...request(wire), effectKey: "a\0b" },
		{ ...request(wire), effectKey: "e\u0301" },
		{ ...request(wire), effectKey: "\ud800" },
		{ ...request(wire), effectKey: "x".repeat(257) },
		{ ...request(wire), effectKey: "😀".repeat(256) + "x" },
	] as const) {
		const before = { ...entered };
		expect(() =>
			negotiateOperationWireV3({
				...base,
				selectedOperation: "action:delivery.publish",
				request: hostile,
			}),
		).toThrow(/request (?:callId|effectKey) is invalid/);
		expect(entered).toEqual(before);
	}
});
