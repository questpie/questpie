/**
 * Test helpers for job handler and RPC function tests.
 *
 * Provides mock CRUD collections, mock queue, and mock job context factory
 * that simulates the QUESTPIE runtime context shape expected by the job handlers.
 */

import type { CollectionCrud } from "../../src/server/client.js";

// ── Mock CRUD ──────────────────────────────────────────────

function matchesWhere(record: any, key: string, value: any): boolean {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		if ("in" in value) {
			return (value.in as any[]).includes(record[key]);
		}
		if ("lte" in value) {
			return record[key] <= value.lte;
		}
		if ("gte" in value) {
			return record[key] >= value.gte;
		}
	}
	return record[key] === value;
}

export function createMockCrud(
	store: Map<string, any> = new Map(),
): CollectionCrud & {
	deleteById: (params: any, context?: any) => Promise<void>;
} {
	let idCounter = 0;
	return {
		async create(input: any, _context?: any) {
			const id = input.id ?? `id-${++idCounter}`;
			const record = {
				id,
				...input,
				createdAt: input.createdAt ?? new Date(),
			};
			store.set(id, record);
			return record;
		},
		async findOne(options?: any, _context?: any) {
			const where = options?.where ?? {};
			for (const [, record] of store) {
				let match = true;
				for (const [key, value] of Object.entries(where)) {
					if (!matchesWhere(record, key, value)) {
						match = false;
						break;
					}
				}
				if (match) return record;
			}
			return null;
		},
		async find(options?: any, _context?: any) {
			const where = options?.where ?? {};
			const docs: any[] = [];
			for (const [, record] of store) {
				let match = true;
				for (const [key, value] of Object.entries(where)) {
					if (!matchesWhere(record, key, value)) {
						match = false;
						break;
					}
				}
				if (match) docs.push(record);
			}
			// Apply limit
			const limit = options?.limit ?? docs.length;
			return { docs: docs.slice(0, limit), totalDocs: docs.length };
		},
		async updateById(params: any, _context?: any) {
			const record = store.get(params.id);
			if (!record) throw new Error(`Not found: ${params.id}`);
			Object.assign(record, params.data);
			return record;
		},
		async deleteById(params: any, _context?: any) {
			store.delete(params.id);
		},
	};
}

// ── Mock Queue ─────────────────────────────────────────────

export interface MockQueueChannel {
	calls: Array<{ payload: any; options?: any }>;
	publish(payload: any, options?: any): Promise<{ id: string }>;
}

export function createMockQueueChannel(): MockQueueChannel {
	const calls: Array<{ payload: any; options?: any }> = [];
	return {
		calls,
		async publish(payload: any, options?: any) {
			calls.push({ payload, options });
			return { id: `job-${calls.length}` };
		},
	};
}

/**
 * Create a mock queue proxy that auto-creates channels on access.
 */
export function createMockQueue(): Record<string, MockQueueChannel> & {
	_channels: Map<string, MockQueueChannel>;
} {
	const channels = new Map<string, MockQueueChannel>();

	return new Proxy(
		{ _channels: channels } as Record<string, MockQueueChannel> & {
			_channels: Map<string, MockQueueChannel>;
		},
		{
			get(_target, prop: string) {
				if (prop === "_channels") return channels;
				if (!channels.has(prop)) {
					channels.set(prop, createMockQueueChannel());
				}
				// biome-ignore lint/style/noNonNullAssertion: guaranteed by has() check above
				return channels.get(prop)!;
			},
		},
	);
}

// ── Mock Logger ────────────────────────────────────────────

export interface MockLogger {
	debugCalls: any[];
	infoCalls: any[];
	warnCalls: any[];
	errorCalls: any[];
	debug: (...args: any[]) => void;
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	error: (...args: any[]) => void;
}

export function createMockLogger(): MockLogger {
	const logger: MockLogger = {
		debugCalls: [],
		infoCalls: [],
		warnCalls: [],
		errorCalls: [],
		debug(...args: any[]) {
			logger.debugCalls.push(args);
		},
		info(...args: any[]) {
			logger.infoCalls.push(args);
		},
		warn(...args: any[]) {
			logger.warnCalls.push(args);
		},
		error(...args: any[]) {
			logger.errorCalls.push(args);
		},
	};
	return logger;
}

// ── Mock Job Context ───────────────────────────────────────

export interface MockStores {
	instances: Map<string, any>;
	steps: Map<string, any>;
	events: Map<string, any>;
	logs: Map<string, any>;
}

export function createMockStores(): MockStores {
	return {
		instances: new Map(),
		steps: new Map(),
		events: new Map(),
		logs: new Map(),
	};
}

/**
 * Create a mock job handler context simulating the QUESTPIE runtime shape.
 *
 * The context has: payload, collections, queue, logger, app (with state.workflows).
 */
export function createJobContext(
	payload: any,
	options?: {
		stores?: MockStores;
		workflows?: Record<string, any>;
	},
) {
	const stores = options?.stores ?? createMockStores();
	const queue = createMockQueue();
	const logger = createMockLogger();

	const collections: Record<string, any> = {
		wf_instance: createMockCrud(stores.instances),
		wf_step: createMockCrud(stores.steps),
		wf_event: createMockCrud(stores.events),
		wf_log: createMockCrud(stores.logs),
	};

	const app = {
		state: {
			workflows: options?.workflows ?? {},
		},
	};

	const ctx: any = {
		payload,
		collections,
		queue,
		logger,
		app,
	};

	return { ctx, stores, queue, logger, collections };
}

/**
 * Create a mock function handler context simulating the QUESTPIE runtime shape.
 *
 * The context has: input, collections, queue, app (with state.workflows).
 * RPC fn handlers destructure `{ input, ...ctx }`, so spread the rest as top-level.
 */
export function createFnContext(
	input: any,
	options?: {
		stores?: MockStores;
		workflows?: Record<string, any>;
	},
) {
	const stores = options?.stores ?? createMockStores();
	const queue = createMockQueue();
	const logger = createMockLogger();

	const collections: Record<string, any> = {
		wf_instance: createMockCrud(stores.instances),
		wf_step: createMockCrud(stores.steps),
		wf_event: createMockCrud(stores.events),
		wf_log: createMockCrud(stores.logs),
	};

	const app = {
		state: {
			workflows: options?.workflows ?? {},
		},
	};

	const ctx: any = {
		input,
		collections,
		queue,
		logger,
		app,
	};

	return { ctx, stores, queue, logger, collections };
}
