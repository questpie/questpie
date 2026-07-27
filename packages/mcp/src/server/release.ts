import type { Questpie } from "questpie";

import { resolveMcpCatalog, type ResolvedMcpCatalog } from "./catalog.js";
import {
	McpExecutionBoundary,
	McpExecutionGate,
} from "./execution-boundary.js";
import { resolveMcpConfig, resolveWorkloadMcpConfig } from "./policy.js";
import type { QuestpieApp } from "./runtime.js";
import type { McpConfig } from "./types.js";

export interface ResolvedMcpRelease {
	readonly config: Readonly<McpConfig>;
	readonly catalog: ResolvedMcpCatalog;
	readonly execution: McpExecutionBoundary;
}

const releases = new WeakMap<object, ResolvedMcpRelease>();
const executionGates = new WeakMap<object, McpExecutionGate>();

function executionGate(app: QuestpieApp): McpExecutionGate {
	const key = app as object;
	const existing = executionGates.get(key);
	if (existing) return existing;
	const created = new McpExecutionGate();
	executionGates.set(key, created);
	return created;
}

function freezeConfig<T>(value: T, seen = new WeakSet<object>()): T {
	if (!value || typeof value !== "object" || seen.has(value as object)) {
		return value;
	}
	seen.add(value as object);
	for (const entry of Object.values(value as Record<string, unknown>)) {
		freezeConfig(entry, seen);
	}
	return Object.freeze(value);
}

function createRelease(
	app: QuestpieApp,
	config: McpConfig,
	options?: { resources?: boolean },
): ResolvedMcpRelease {
	const releaseConfig =
		options?.resources === false
			? {
					...config,
					resources: {
						collections: Object.create(null),
						globals: Object.create(null),
						routes: Object.create(null),
					},
				}
			: config;
	const frozenConfig = freezeConfig(releaseConfig);
	const catalog = resolveMcpCatalog(app, frozenConfig);
	const execution = new McpExecutionBoundary(
		frozenConfig.execution,
		executionGate(app),
	);
	const toolCount =
		[...catalog.collections.values()].reduce(
			(total, entry) => total + entry.operations.length,
			0,
		) +
		[...catalog.globals.values()].reduce(
			(total, entry) => total + entry.operations.length,
			0,
		) +
		catalog.routes.size +
		catalog.customTools.size;
	const resourceCount =
		catalog.resources.collections.size +
		catalog.resources.globals.size +
		catalog.resources.routes.size;
	if (toolCount > execution.limits.maxTools) {
		throw new Error("MCP released tool count exceeds configured limit");
	}
	if (resourceCount > execution.limits.maxResources) {
		throw new Error("MCP released resource count exceeds configured limit");
	}
	return Object.freeze({ config: frozenConfig, catalog, execution });
}

/** App-owned release snapshot shared by OAuth advertisement and default servers. */
export function getAppMcpRelease(app: QuestpieApp): ResolvedMcpRelease {
	const key = app as object;
	const existing = releases.get(key);
	if (existing) return existing;
	const created = createRelease(
		app,
		resolveMcpConfig(app as unknown as Questpie<any>),
	);
	releases.set(key, created);
	return created;
}

/** Explicit programmatic overrides are isolated snapshots, never OAuth state. */
export function createIsolatedMcpRelease(
	app: QuestpieApp,
	override: McpConfig,
): ResolvedMcpRelease {
	return createRelease(
		app,
		resolveMcpConfig(app as unknown as Questpie<any>, override),
	);
}

/** Workload authority is isolated and resources remain unavailable. */
export function createWorkloadMcpRelease(
	app: QuestpieApp,
	override?: McpConfig,
): ResolvedMcpRelease {
	return createRelease(
		app,
		resolveWorkloadMcpConfig(app as unknown as Questpie<any>, override),
		{ resources: false },
	);
}
