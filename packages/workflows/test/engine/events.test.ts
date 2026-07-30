import { describe, expect, it } from "bun:test";

import {
	checkRetroactiveMatch,
	dispatchEvent,
	matchesCriteria,
} from "../../src/server/engine/events.js";
import {
	createMockEventPersistence,
	createMockResumeWaiter,
} from "./helpers.js";

describe("matchesCriteria", () => {
	it("returns true when criteria is null", () => {
		expect(matchesCriteria(null, { foo: 1 })).toBe(true);
	});

	it("returns true when criteria is undefined", () => {
		expect(matchesCriteria(undefined, { foo: 1 })).toBe(true);
	});

	it("returns true when criteria is empty object", () => {
		expect(matchesCriteria({}, { foo: 1 })).toBe(true);
	});

	it("returns false when has criteria but target is null", () => {
		expect(matchesCriteria({ foo: 1 }, null)).toBe(false);
	});

	it("returns false when has criteria but target is undefined", () => {
		expect(matchesCriteria({ foo: 1 }, undefined)).toBe(false);
	});

	it("matches simple key-value pair", () => {
		expect(matchesCriteria({ userId: "u1" }, { userId: "u1" })).toBe(true);
	});

	it("fails when value doesn't match", () => {
		expect(matchesCriteria({ userId: "u1" }, { userId: "u2" })).toBe(false);
	});

	it("matches subset (containment)", () => {
		expect(
			matchesCriteria({ userId: "u1" }, { userId: "u1", orderId: "o1" }),
		).toBe(true);
	});

	it("fails when criteria key is missing from target", () => {
		expect(matchesCriteria({ userId: "u1" }, { orderId: "o1" })).toBe(false);
	});

	it("matches nested objects recursively", () => {
		expect(
			matchesCriteria(
				{ user: { id: "u1" } },
				{ user: { id: "u1", name: "Alice" } },
			),
		).toBe(true);
	});

	it("fails nested object mismatch", () => {
		expect(
			matchesCriteria({ user: { id: "u1" } }, { user: { id: "u2" } }),
		).toBe(false);
	});

	it("matches multiple criteria keys", () => {
		expect(
			matchesCriteria(
				{ userId: "u1", status: "active" },
				{ userId: "u1", status: "active", extra: true },
			),
		).toBe(true);
	});

	it("fails when one of multiple criteria doesn't match", () => {
		expect(
			matchesCriteria(
				{ userId: "u1", status: "active" },
				{ userId: "u1", status: "inactive" },
			),
		).toBe(false);
	});
});

describe("dispatchEvent", () => {
	it("creates an event and resumes matching waiters", async () => {
		const { persistence, store } = createMockEventPersistence({
			waitingSteps: [
				{
					instanceId: "inst-1",
					stepName: "wait-step",
					eventName: "user.created",
					matchCriteria: null,
				},
			],
		});
		const { fn: resumeWaiter, calls } = createMockResumeWaiter();

		const result = await dispatchEvent(
			{
				name: "user.created",
				data: { id: "u1" },
				sourceType: "external",
			},
			persistence,
			resumeWaiter,
		);

		expect(result.matchedCount).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0].instanceId).toBe("inst-1");
		expect(calls[0].stepName).toBe("wait-step");
		expect(calls[0].result).toEqual({ id: "u1" });
		expect(store.events).toHaveLength(1);
	});

	it("returns matchedCount 0 when no waiters exist", async () => {
		const { persistence } = createMockEventPersistence();
		const { fn: resumeWaiter, calls } = createMockResumeWaiter();

		const result = await dispatchEvent(
			{
				name: "user.created",
				data: { id: "u1" },
				sourceType: "external",
			},
			persistence,
			resumeWaiter,
		);

		expect(result.matchedCount).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("filters waiters by criteria match", async () => {
		const { persistence } = createMockEventPersistence({
			waitingSteps: [
				{
					instanceId: "inst-1",
					stepName: "wait-u1",
					eventName: "user.created",
					matchCriteria: { userId: "u1" },
				},
				{
					instanceId: "inst-2",
					stepName: "wait-u2",
					eventName: "user.created",
					matchCriteria: { userId: "u2" },
				},
			],
		});
		const { fn: resumeWaiter, calls } = createMockResumeWaiter();

		const result = await dispatchEvent(
			{
				name: "user.created",
				data: { id: "u1" },
				match: { userId: "u1" },
				sourceType: "external",
			},
			persistence,
			resumeWaiter,
		);

		// Only inst-1 matches (criteria { userId: "u1" } contained in match { userId: "u1" })
		expect(result.matchedCount).toBe(1);
		expect(calls[0].instanceId).toBe("inst-1");
	});

	it("resumes multiple matching waiters", async () => {
		const { persistence } = createMockEventPersistence({
			waitingSteps: [
				{
					instanceId: "inst-1",
					stepName: "wait-a",
					eventName: "order.paid",
					matchCriteria: null,
				},
				{
					instanceId: "inst-2",
					stepName: "wait-b",
					eventName: "order.paid",
					matchCriteria: null,
				},
			],
		});
		const { fn: resumeWaiter, calls } = createMockResumeWaiter();

		const result = await dispatchEvent(
			{
				name: "order.paid",
				data: { amount: 100 },
				sourceType: "workflow",
				sourceInstanceId: "src-1",
			},
			persistence,
			resumeWaiter,
		);

		expect(result.matchedCount).toBe(2);
		expect(calls).toHaveLength(2);
	});
});

describe("checkRetroactiveMatch", () => {
	it("returns event data when a matching event exists", async () => {
		const { persistence, store } = createMockEventPersistence({
			events: [
				{
					id: "evt-existing",
					eventName: "user.created",
					data: { id: "u1" },
					matchCriteria: { userId: "u1" },
					sourceType: "external",
					consumedCount: 0,
				},
			],
		});

		const result = await checkRetroactiveMatch(
			"user.created",
			{ userId: "u1" },
			persistence,
		);

		expect(result).not.toBeNull();
		expect(result!.data).toEqual({ id: "u1" });
		// Should mark as consumed
		expect(store.events[0].consumedCount).toBe(1);
	});

	it("returns null when no matching event exists", async () => {
		const { persistence } = createMockEventPersistence();

		const result = await checkRetroactiveMatch(
			"user.created",
			{ userId: "u1" },
			persistence,
		);

		expect(result).toBeNull();
	});

	it("returns null when event name doesn't match", async () => {
		const { persistence } = createMockEventPersistence({
			events: [
				{
					id: "evt-1",
					eventName: "order.paid",
					data: { id: "o1" },
					matchCriteria: null,
					sourceType: "external",
					consumedCount: 0,
				},
			],
		});

		const result = await checkRetroactiveMatch(
			"user.created",
			undefined,
			persistence,
		);

		expect(result).toBeNull();
	});
});
