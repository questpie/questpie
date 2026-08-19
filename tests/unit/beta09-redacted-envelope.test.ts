import { expect, test } from "bun:test";

import type { ExecutionEventV1 } from "../../packages/runtime/src/application/events";
import { createEventEmitter } from "../../packages/runtime/src/application/events";
import { isOperationCallId } from "../../packages/runtime/src/operation/call-identity";

/**
 * The redacted-envelope hostile case.
 *
 * `hostile-cases.md` case 2 first read this as structurally satisfied: the event
 * union is closed, so nothing could carry a payload. That was overstated. The
 * union is closed; the envelope wrapping it is not. Four of its fields are
 * strings, and `packages/runtime/src/application/index.ts:279`-`:289` fills two
 * of them from the caller own `callId` verbatim -- as `correlationId` and as an
 * `operationCall` link.
 *
 * So the case has two halves and neither is vacuous. The envelope must carry no
 * operation payload, and the one field a caller fully controls must be bounded
 * before it reaches telemetry a host may ship anywhere.
 */

const SECRET = "correct-horse-battery-staple";
const LONE_SURROGATE = String.fromCharCode(0xd800);
const FOUR_BYTE = String.fromCodePoint(0x1f600);
const COMBINING_NFD = String.fromCharCode(0x65, 0x301);

function decoded(value: unknown): string {
	if (value instanceof Uint8Array) return new TextDecoder().decode(value);
	if (Array.isArray(value)) return value.map(decoded).join(" ");
	if (value && typeof value === "object")
		return Object.values(value).map(decoded).join(" ");
	return String(value);
}

test("the envelope carries no operation payload, only identities", () => {
	const events: ExecutionEventV1[] = [];
	const emit = createEventEmitter({
		application: "application:collaboration",
		deploymentDigest: "sha256:deadbeef",
		sink: (event) => events.push(event),
		now: () => new Date("2026-08-19T00:00:00.000Z"),
	});

	// Exactly the shape packages/runtime/src/application/index.ts:279 builds.
	const callId = "call:publish:1";
	emit(
		{
			family: "operation",
			kind: "result",
			operation: "mutation:message.publish",
		},
		{
			executionId: "execution:1",
			correlationId: callId,
			principalRef: "user:018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			links: [
				{ kind: "operation", id: "mutation:message.publish" },
				{ kind: "operationCall", id: callId },
			],
		},
	);

	expect(events).toHaveLength(1);
	const emitted = events[0]!;

	// The Message body never reaches the envelope, because there is no field it
	// could occupy. This is the half the record was right about.
	expect(decoded(emitted)).not.toContain(SECRET);

	// Every free-form field carries an identity rather than content.
	expect(emitted.envelope.correlationId).toBe(callId);
	expect(emitted.envelope.actor.principalRef).toBe(
		"user:018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
	);
	expect([...emitted.envelope.links].map(({ id }) => id).sort()).toEqual([
		callId,
		"mutation:message.publish",
	]);

	// The typed-null fields stay null; they are not a place to hide a payload.
	expect(emitted.envelope.traceId).toBeNull();
	expect(emitted.envelope.causationId).toBeNull();
	expect(emitted.envelope.actor.tenantRef).toBeNull();
	expect(emitted.durability).toBe("telemetry");
});

test("the one caller-controlled envelope field is bounded before it is emitted", () => {
	// A caller supplies callId and the runtime copies it verbatim into
	// correlationId and into a link id. What keeps that from being an injection
	// channel into whatever a host does with telemetry is this validator, so the
	// case is driven against it directly.
	expect(isOperationCallId("call:publish:1")).toBe(true);

	// The bound is on shape, not on content, and this is the finding rather than
	// an aside. Arbitrary readable text passes, so the envelope's correlationId
	// is untrusted caller input that a host shipping telemetry must treat as
	// such. Nothing is redacted; the envelope simply has no field a payload could
	// occupy, and the one field a caller fills is bounded.
	expect(isOperationCallId("call:" + SECRET + " injected")).toBe(true);
	expect(isOperationCallId("x".repeat(257))).toBe(false);
	expect(isOperationCallId("x".repeat(256))).toBe(true);
	expect(isOperationCallId(COMBINING_NFD.repeat(128))).toBe(false);
	expect(isOperationCallId("")).toBe(false);
	expect(isOperationCallId(null)).toBe(false);

	// A lone surrogate cannot reach the envelope and become invalid UTF-8 in
	// whatever consumes it.
	expect(isOperationCallId("call:" + LONE_SURROGATE)).toBe(false);

	// 256 scalars is not 256 bytes: a four-byte scalar reaches the 1024-byte
	// bound at exactly the same point, and both bounds are enforced.
	expect(new TextEncoder().encode(FOUR_BYTE.repeat(256)).byteLength).toBe(
		1_024,
	);
	expect(isOperationCallId(FOUR_BYTE.repeat(256))).toBe(true);
	expect(isOperationCallId(FOUR_BYTE.repeat(257))).toBe(false);
});
