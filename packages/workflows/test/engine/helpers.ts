/**
 * Test helpers — mock persistence layers for step context and event tests.
 */

import type {
	EventPersistence,
	ResumeWaiterFn,
} from "../../src/server/engine/events.js";
import { matchesCriteria } from "../../src/server/engine/events.js";
import type {
	CachedStep,
	StepPersistence,
	TriggerChildFn,
} from "../../src/server/engine/step-context.js";
import { StepExecutionContext } from "../../src/server/engine/step-context.js";

// ── Step persistence mock ──────────────────────────────────

/** Records of created/updated steps for assertions. */
export interface MockPersistenceLog {
	created: Array<Parameters<StepPersistence["createStep"]>[0]>;
	updated: Array<{
		instanceId: string;
		name: string;
		update: Parameters<StepPersistence["updateStep"]>[2];
	}>;
}

/**
 * Creates a mock StepPersistence that records all operations.
 */
export function createMockPersistence(): {
	persistence: StepPersistence;
	log: MockPersistenceLog;
} {
	const log: MockPersistenceLog = { created: [], updated: [] };
	let stepIdCounter = 0;

	const persistence: StepPersistence = {
		async createStep(step) {
			log.created.push(step);
			return { id: `step-${++stepIdCounter}` };
		},
		async updateStep(instanceId, name, update) {
			log.updated.push({ instanceId, name, update });
		},
	};

	return { persistence, log };
}

// ── Event persistence mock ─────────────────────────────────

export interface MockEventStore {
	events: Array<{
		id: string;
		eventName: string;
		data: unknown;
		matchCriteria: Record<string, any> | null;
		sourceType: string;
		consumedCount: number;
	}>;
	waitingSteps: Array<{
		instanceId: string;
		stepName: string;
		eventName: string;
		matchCriteria: Record<string, any> | null;
	}>;
}

export function createMockEventPersistence(store?: Partial<MockEventStore>): {
	persistence: EventPersistence;
	store: MockEventStore;
} {
	const eventStore: MockEventStore = {
		events: store?.events ?? [],
		waitingSteps: store?.waitingSteps ?? [],
	};
	let eventIdCounter = 0;

	const persistence: EventPersistence = {
		async createEvent(ev) {
			const id = `evt-${++eventIdCounter}`;
			eventStore.events.push({
				id,
				eventName: ev.eventName,
				data: ev.data ?? null,
				matchCriteria: (ev.matchCriteria as Record<string, any>) ?? null,
				sourceType: ev.sourceType,
				consumedCount: 0,
			});
			return { id };
		},
		async findMatchingEvent(eventName, matchCriteria) {
			for (const event of eventStore.events) {
				if (event.eventName !== eventName) continue;
				if (matchesCriteria(matchCriteria, event.matchCriteria)) {
					return { id: event.id, data: event.data };
				}
			}
			return null;
		},
		async findWaitingSteps(eventName, _matchData) {
			return eventStore.waitingSteps.filter((s) => s.eventName === eventName);
		},
		async markEventConsumed(eventId) {
			const event = eventStore.events.find((e) => e.id === eventId);
			if (event) {
				event.consumedCount++;
			}
		},
	};

	return { persistence, store: eventStore };
}

// ── Resume waiter mock ─────────────────────────────────────

export function createMockResumeWaiter(): {
	fn: ResumeWaiterFn;
	calls: Array<{ instanceId: string; stepName: string; result: unknown }>;
} {
	const calls: Array<{
		instanceId: string;
		stepName: string;
		result: unknown;
	}> = [];

	const fn: ResumeWaiterFn = async (instanceId, stepName, result) => {
		calls.push({ instanceId, stepName, result });
	};

	return { fn, calls };
}

// ── Trigger child mock ─────────────────────────────────────

export function createMockTriggerChild(): {
	fn: TriggerChildFn;
	calls: Array<{
		workflowName: string;
		input: unknown;
		options: {
			parentInstanceId: string;
			parentStepName: string;
			timeout?: string;
		};
	}>;
} {
	let childIdCounter = 0;
	const calls: Array<{
		workflowName: string;
		input: unknown;
		options: {
			parentInstanceId: string;
			parentStepName: string;
			timeout?: string;
		};
	}> = [];

	const fn: TriggerChildFn = async (workflowName, input, options) => {
		calls.push({ workflowName, input, options });
		return { instanceId: `child-${++childIdCounter}` };
	};

	return { fn, calls };
}

// ── Test step context factory ──────────────────────────────

/**
 * Creates a StepExecutionContext with mock persistence layers.
 */
export function createTestStepContext(options?: {
	instanceId?: string;
	cachedSteps?: CachedStep[];
	cachedExecutionOrder?: string[];
	defaultRetry?: { maxAttempts?: number };
	eventPersistence?: EventPersistence;
	resumeWaiter?: ResumeWaiterFn;
	triggerChild?: TriggerChildFn;
}): {
	ctx: StepExecutionContext;
	persistence: StepPersistence;
	log: MockPersistenceLog;
} {
	const { persistence, log } = createMockPersistence();
	const cachedMap = new Map<string, CachedStep>();
	const cachedOrder: string[] = [];

	if (options?.cachedSteps) {
		for (const step of options.cachedSteps) {
			cachedMap.set(step.name, step);
		}
	}
	if (options?.cachedExecutionOrder) {
		cachedOrder.push(...options.cachedExecutionOrder);
	}

	const ctx = new StepExecutionContext(
		options?.instanceId ?? "test-instance",
		cachedMap,
		cachedOrder,
		persistence,
		options?.defaultRetry,
		options?.eventPersistence,
		options?.resumeWaiter,
		options?.triggerChild,
	);

	return { ctx, persistence, log };
}
