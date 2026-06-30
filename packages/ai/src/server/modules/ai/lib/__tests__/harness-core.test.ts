import { describe, expect, it } from "bun:test";

import {
	createInMemoryHarnessSessionStore,
	resumeOrCreateSession,
} from "../harness-core.js";

// Minimal stubs — `resumeOrCreateSession` only reads `session.isResume` and
// calls `session.detach()`, and only calls `agent.createSession(args)`. We stub
// exactly those so the resume/persist contract (the seam every harness producer
// depends on) is tested deterministically, without spawning a real agent.

function stubSession(isResume: boolean, detachState: unknown) {
	let detachCalls = 0;
	return {
		session: {
			isResume,
			async detach() {
				detachCalls += 1;
				return detachState;
			},
		} as any,
		detachCalls: () => detachCalls,
	};
}

function stubAgent(session: unknown) {
	const calls: Array<{ sessionId: string; resumeFrom: unknown }> = [];
	return {
		calls,
		agent: {
			async createSession(args: { sessionId: string; resumeFrom: unknown }) {
				calls.push({ sessionId: args.sessionId, resumeFrom: args.resumeFrom });
				return session;
			},
		} as any,
	};
}

describe("harness-core: in-memory session store", () => {
	it("round-trips resume state by id; missing ids load undefined", async () => {
		const store = createInMemoryHarnessSessionStore();
		const state = { resume: "token" } as any;

		await store.save("chat-1", state);

		expect(await store.load("chat-1")).toBe(state);
		expect(await store.load("absent")).toBeUndefined();
	});
});

describe("harness-core: resumeOrCreateSession", () => {
	it("creates a fresh session when there is no resume state", async () => {
		const { session } = stubSession(false, { detached: true });
		const { agent, calls } = stubAgent(session);

		const resumed = await resumeOrCreateSession({ agent, id: "chat-1" });

		expect(calls).toHaveLength(1);
		expect(calls[0].sessionId).toBe("chat-1");
		expect(calls[0].resumeFrom).toBeUndefined();
		expect(resumed.isResume).toBe(false);
		expect(resumed.resumeFrom).toBeUndefined();
	});

	it("threads loaded resume state into createSession on resume", async () => {
		const priorState = { resume: "prior" } as any;
		const { session } = stubSession(true, { detached: true });
		const { agent, calls } = stubAgent(session);

		const resumed = await resumeOrCreateSession({
			agent,
			id: "chat-2",
			loadResumeState: async (id) => (id === "chat-2" ? priorState : null),
		});

		expect(calls[0].resumeFrom).toBe(priorState);
		expect(resumed.isResume).toBe(true);
		expect(resumed.resumeFrom).toBe(priorState);
	});

	it("detachAndPersist detaches the session and saves the new state", async () => {
		const newState = { resume: "next" } as any;
		const { session, detachCalls } = stubSession(false, newState);
		const { agent } = stubAgent(session);
		const saved: Array<{ id: string; state: unknown }> = [];

		const resumed = await resumeOrCreateSession({
			agent,
			id: "chat-3",
			saveResumeState: async (id, state) => {
				saved.push({ id, state });
			},
		});

		const returned = await resumed.detachAndPersist();

		expect(detachCalls()).toBe(1);
		expect(returned).toBe(newState);
		expect(saved).toEqual([{ id: "chat-3", state: newState }]);
	});

	it("round-trips through the in-memory store so the next turn resumes", async () => {
		const store = createInMemoryHarnessSessionStore();
		const newState = { resume: "persisted" } as any;
		const { session } = stubSession(false, newState);
		const { agent } = stubAgent(session);

		const resumed = await resumeOrCreateSession({
			agent,
			id: "chat-4",
			loadResumeState: store.load,
			saveResumeState: store.save,
		});
		await resumed.detachAndPersist();

		// A subsequent producer turn for the same chat session loads the persisted
		// state and resumes from it.
		expect(await store.load("chat-4")).toBe(newState);
	});
});
