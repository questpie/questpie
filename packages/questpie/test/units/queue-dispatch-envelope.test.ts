import { describe, expect, test } from "bun:test";

import {
	decodeQueueDispatchEnvelope,
	encodeQueueDispatchEnvelope,
} from "../../src/server/modules/core/integrated/queue/dispatch-envelope.js";

const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";

describe("Queue dispatch envelope", () => {
	test("round-trips only when the envelope identity matches the physical Job", () => {
		const encoded = encodeQueueDispatchEnvelope(
			{ value: "current" },
			dispatchId,
			"notify:current",
		);

		expect(decodeQueueDispatchEnvelope(encoded, dispatchId)).toEqual({
			data: { value: "current" },
			dispatchId,
			idempotencyKey: "notify:current",
		});
	});

	test("does not corrupt a legacy user payload that resembles the framework envelope", () => {
		const legacyPayload = {
			__questpieQueue: {
				version: 1,
				dispatchId,
				idempotencyKey: "user-owned",
			},
			payload: { value: "nested user data" },
		};

		expect(
			decodeQueueDispatchEnvelope(
				legacyPayload,
				"71ef0739-b21f-4c60-a7bc-cb8da739da6e",
			),
		).toEqual({ data: legacyPayload });
		expect(decodeQueueDispatchEnvelope(legacyPayload, "legacy-job-id")).toEqual(
			{
				data: legacyPayload,
			},
		);
	});
});
