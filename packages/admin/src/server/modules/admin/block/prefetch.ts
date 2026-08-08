/**
 * Server CRUD Block Prefetch Utility
 *
 * Handles data fetching for blocks during the afterRead hook.
 * The fetched data is attached to `_data[blockId]` in the response.
 *
 * Two mechanisms populate `_data`:
 *
 * 1. **Declared field expansion** (`.prefetch({ with: [...] })`): Explicitly
 *    declared relation/upload fields are batch-fetched and expanded to full records.
 *    Only the fields listed in `with` are expanded — nothing is implicit.
 *
 * 2. **Custom prefetch function** (`.prefetch(fn)`): For computed data that can't
 *    be auto-expanded, define a prefetch function that returns arbitrary data.
 *
 * 3. **Expand + loader** (`.prefetch({ with: [...], loader })`): Expand fields
 *    first, then pass the expanded data to a loader for additional processing.
 *
 * @example
 * ```ts
 * // Shape 1: Pure function
 * block("featuredPosts").prefetch(async ({ values, ctx }) => {
 *   return { posts: await fetchPosts(values.count) };
 * })
 *
 * // Shape 2: Expand specific fields
 * block("hero").prefetch({ with: ['backgroundImage'] })
 *
 * // Shape 3: Expand + custom loader
 * block("hero").prefetch({
 *   with: ['backgroundImage'],
 *   loader: async ({ expanded, ctx }) => ({
 *     analytics: await getStats(),
 *   }),
 * })
 * ```
 */

import { runWithContext, tryGetContext } from "questpie";

import type { BlocksDocument } from "../../../fields/blocks.js";
import type {
	AnyBlockDefinition,
	BlockPrefetchContext,
} from "./block-builder.js";

/**
 * Internal questpie marker (global symbol registry): upload-field expansions
 * populate through the PARENT row's read decision — the blocks document came
 * from a row the caller could already read, and the asset ids are
 * editor-curated content stored on that row. Collection-level read access is
 * inherited; field-level read rules on the upload collection still apply.
 * JSON cannot carry symbols, so HTTP input can never inject this.
 */
const INHERIT_ACCESS = Symbol.for("questpie.internal.inheritAccess");

/**
 * Context for blocks prefetch processing.
 * Use `typedApp<App>(ctx.app)` for typed access.
 */
export interface BlocksPrefetchContext {
	/** app instance — use `typedApp<App>(ctx.app)` for typed access */
	app: any;
	/** Database client */
	db: unknown;
	/** Current session */
	session?: unknown | null;
	/** Current locale */
	locale?: string;
	/** Current CRUD access mode */
	accessMode?: string;
	/** Current workflow stage */
	stage?: string;
	/** Collections accessor */
	collections?: unknown;
	/** Globals accessor */
	globals?: unknown;
	/** Structural runtime logger inherited from the active CRUD context. */
	logger?: {
		warn(message: string, ...args: unknown[]): void;
		error(message: string, ...args: unknown[]): void;
	};
}

function prefetchLogger(ctx: BlocksPrefetchContext) {
	return (
		ctx.logger ??
		(ctx.app as { logger?: BlocksPrefetchContext["logger"] })?.logger
	);
}

function resolvePrefetchContext(
	ctx: BlocksPrefetchContext,
): BlocksPrefetchContext {
	const stored = tryGetContext();
	const app = ctx.app ?? stored?.app;

	return {
		...ctx,
		app,
		db: ctx.db ?? stored?.db,
		session: ctx.session === null ? null : (ctx.session ?? stored?.session),
		locale: ctx.locale ?? stored?.locale,
		accessMode: ctx.accessMode ?? stored?.accessMode,
		stage: ctx.stage ?? stored?.stage,
		collections: ctx.collections ?? (app as any)?.collections,
		globals: ctx.globals ?? (app as any)?.globals,
	};
}

function toRuntimeContext(ctx: BlocksPrefetchContext) {
	return {
		app: ctx.app,
		db: ctx.db,
		session: ctx.session,
		locale: ctx.locale,
		accessMode: ctx.accessMode,
		stage: ctx.stage,
	};
}

function toCrudContext(ctx: BlocksPrefetchContext) {
	return {
		db: ctx.db,
		session: ctx.session,
		locale: ctx.locale,
		accessMode: ctx.accessMode,
		stage: ctx.stage,
	};
}

// ============================================================================
// Declared field expansion (replaces old auto-expansion)
// ============================================================================

/**
 * Tracks a field that needs expansion.
 * @internal
 */
interface ExpansionTarget {
	blockId: string;
	fieldName: string;
	/** Whether the original value was a single ID (not an array) */
	isSingle: boolean;
	/** Nested `with` config to pass through to the collection's find call */
	nestedWith?: Record<string, unknown>;
}

function normalizeBlockDefinitions(
	blockDefinitions: Record<string, AnyBlockDefinition>,
): Record<string, AnyBlockDefinition> {
	const normalized: Record<string, AnyBlockDefinition> = {};

	for (const [key, blockDef] of Object.entries(blockDefinitions)) {
		normalized[key] = blockDef;

		const runtimeName = blockDef.state?.name ?? blockDef.name;
		if (runtimeName) {
			normalized[runtimeName] = blockDef;
		}
	}

	return normalized;
}

/**
 * Expand relation/upload fields declared in `prefetchWith`.
 *
 * Uses the same object syntax as `with` in find operations:
 * ```ts
 * { backgroundImage: true, author: { with: { avatar: true } } }
 * ```
 *
 * Nested `with` is passed through to the collection's `find` call,
 * reusing the existing relation resolution machinery.
 *
 * @internal
 */
async function expandDeclaredFields(
	allNodes: Array<{ id: string; type: string }>,
	values: Record<string, Record<string, unknown>>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<Record<string, Record<string, unknown>>> {
	// Group expansion requirements by target collection for batch fetching
	// Key: "collection:kind[:nestedWithHash]" to separate different with
	// configs and upload vs plain-relation fields (uploads inherit access)
	const expansionsByCollection = new Map<
		string,
		{
			ids: Set<string>;
			targets: ExpansionTarget[];
			nestedWith?: Record<string, unknown>;
			inheritAccess?: boolean;
		}
	>();

	for (const node of allNodes) {
		const blockDef = blockDefinitions[node.type];
		const prefetchWith = blockDef?.state.prefetchWith;
		if (!prefetchWith || typeof prefetchWith !== "object") continue;
		if (!blockDef?.state.fields) continue;

		const blockValues = values[node.id] || {};

		for (const [fieldName, fieldConfig] of Object.entries(prefetchWith)) {
			if (!fieldConfig) continue;

			const fieldDef = blockDef.state.fields[fieldName];
			if (!fieldDef || typeof fieldDef !== "object") continue;

			// Get field metadata to find the target collection
			const metadata =
				"getMetadata" in fieldDef &&
				typeof (fieldDef as any).getMetadata === "function"
					? (fieldDef as any).getMetadata()
					: undefined;
			if (!metadata) continue;

			// Support relation fields and upload fields
			if (metadata.type !== "relation") continue;

			const targetCollection = metadata.targetCollection;
			if (!targetCollection || typeof targetCollection !== "string") continue;

			// Extract ID(s) from block value
			const value = blockValues[fieldName];
			if (!value) continue;

			const rawIds = Array.isArray(value) ? value : [value];
			const stringIds = rawIds.filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			);
			if (stringIds.length === 0) continue;

			// Extract nested `with` config (for passing to collection find)
			const nestedWith =
				typeof fieldConfig === "object" && fieldConfig.with
					? (fieldConfig.with as Record<string, unknown>)
					: undefined;

			// Upload fields (f.upload) populate through the parent row's read
			// decision; plain relations keep normal target-collection access
			const isUpload = (metadata as { isUpload?: boolean }).isUpload === true;

			// Group by collection + field kind + nested with config
			const groupKey = `${targetCollection}:${isUpload ? "upload" : "relation"}${
				nestedWith ? `:${JSON.stringify(nestedWith)}` : ""
			}`;

			if (!expansionsByCollection.has(groupKey)) {
				expansionsByCollection.set(groupKey, {
					ids: new Set(),
					targets: [],
					nestedWith,
					inheritAccess: isUpload,
				});
			}
			const entry = expansionsByCollection.get(groupKey)!;
			for (const id of stringIds) entry.ids.add(id);
			entry.targets.push({
				blockId: node.id,
				fieldName,
				isSingle: !Array.isArray(value),
				nestedWith,
			});
		}
	}

	if (expansionsByCollection.size === 0) return {};

	// Batch-fetch records from each target collection
	const fetchedByGroup = new Map<string, Map<string, unknown>>();

	const fetchPromises = [...expansionsByCollection.entries()].map(
		async ([groupKey, { ids, nestedWith, inheritAccess }]) => {
			// Extract collection name from group key
			const collection = groupKey.includes(":")
				? groupKey.slice(0, groupKey.indexOf(":"))
				: groupKey;

			try {
				const collectionApi =
					(ctx.collections as Record<string, any> | undefined)?.[collection] ??
					(ctx.app as any)?.collections?.[collection];
				if (!collectionApi?.find) {
					prefetchLogger(ctx)?.warn(
						`[prefetch] Collection "${collection}" not found on app.collections, skipping`,
					);
					return;
				}

				// Pass nested `with` through to collection's find — reuses existing
				// relation resolution machinery (same as find({ with: { ... } }))
				const findOptions: Record<string, any> = {
					where: { id: { in: [...ids] } },
					limit: ids.size,
					...(nestedWith ? { with: nestedWith } : {}),
				};
				if (inheritAccess) {
					(findOptions as Record<PropertyKey, unknown>)[INHERIT_ACCESS] = true;
				}
				const result = await collectionApi.find(
					findOptions,
					toCrudContext(ctx),
				);

				const recordMap = new Map<string, unknown>();
				for (const doc of result?.docs || []) {
					if (doc && typeof doc === "object" && "id" in doc) {
						recordMap.set((doc as any).id, doc);
					}
				}
				fetchedByGroup.set(groupKey, recordMap);
			} catch (error) {
				prefetchLogger(ctx)?.error(
					`[prefetch] Failed to fetch from "${collection}":`,
					error,
				);
			}
		},
	);
	await Promise.all(fetchPromises);

	// Distribute expanded records to block _data
	const expandedData: Record<string, Record<string, unknown>> = {};

	for (const [groupKey, { targets }] of expansionsByCollection) {
		const recordMap = fetchedByGroup.get(groupKey);
		if (!recordMap) continue;

		for (const { blockId, fieldName, isSingle } of targets) {
			if (!expandedData[blockId]) expandedData[blockId] = {};

			const blockVal = values[blockId]?.[fieldName];
			if (isSingle) {
				expandedData[blockId][fieldName] =
					recordMap.get(blockVal as string) ?? null;
			} else {
				const ids = blockVal as string[];
				expandedData[blockId][fieldName] = ids
					.map((id) => recordMap.get(id))
					.filter(Boolean);
			}
		}
	}

	return expandedData;
}

// ============================================================================
// Prefetch function execution
// ============================================================================

/**
 * Process blocks data for a single blocks document.
 *
 * This function does two things:
 * 1. **Expands declared fields** from `.prefetch({ with: [...] })` (batch-fetched)
 * 2. **Executes prefetch functions/loaders** for blocks that have them
 *
 * The results are merged into `_data[blockId]`. Prefetch function / loader data
 * takes precedence over expanded data on key conflicts.
 *
 * @param blocks - The blocks document to process
 * @param blockDefinitions - Registered block definitions
 * @param ctx - Prefetch context
 * @returns The blocks document with `_data` populated
 */
export async function processBlocksDocument(
	blocks: BlocksDocument | null | undefined,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<BlocksDocument | null | undefined> {
	if (!blocks || !blocks._tree || !blocks._values) {
		return blocks;
	}

	const resolvedCtx = resolvePrefetchContext(ctx);

	return runWithContext(toRuntimeContext(resolvedCtx), async () => {
		// Flatten the tree
		const allNodes: Array<{ id: string; type: string; children: any[] }> = [];
		const collectNodes = (
			nodes: Array<{ id: string; type: string; children: any[] }>,
		) => {
			for (const node of nodes) {
				allNodes.push(node);
				if (node.children.length > 0) {
					collectNodes(node.children);
				}
			}
		};
		collectNodes(blocks._tree);

		const normalizedBlockDefinitions =
			normalizeBlockDefinitions(blockDefinitions);

		// Step 1: Expand declared `with` fields (batch across all blocks)
		const expandedData = await expandDeclaredFields(
			allNodes,
			blocks._values,
			normalizedBlockDefinitions,
			resolvedCtx,
		);

		// Step 2: Execute prefetch functions and loaders
		const prefetchedData = await executePrefetchFunctions(
			allNodes,
			blocks._values,
			normalizedBlockDefinitions,
			resolvedCtx,
			expandedData,
		);

		// Step 3: Merge expanded + prefetched (prefetched overrides on conflict)
		const mergedData: Record<string, Record<string, {}>> = {};
		const allBlockIds = new Set([
			...Object.keys(expandedData),
			...Object.keys(prefetchedData),
		]);

		for (const blockId of allBlockIds) {
			mergedData[blockId] = {
				...(expandedData[blockId] || {}),
				...(prefetchedData[blockId] || {}),
			} as Record<string, {}>;
		}

		return {
			...blocks,
			_data: mergedData,
		};
	});
}

/**
 * Execute prefetch functions and loaders for blocks.
 *
 * Handles two shapes:
 * - Shape 1: `state.prefetch` — call with `{ values, ctx }`
 * - Shape 3: `state._prefetchLoader` — call with `{ values, expanded, ctx }`
 *
 * Shape 2 (with-only) has no function to call — expansion is handled separately.
 *
 * @internal
 */
async function executePrefetchFunctions(
	allNodes: Array<{ id: string; type: string }>,
	values: Record<string, Record<string, unknown>>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
	expandedData: Record<string, Record<string, unknown>>,
): Promise<Record<string, Record<string, unknown>>> {
	const prefetchedData: Record<string, Record<string, unknown>> = {};
	const prefetchPromises: Promise<void>[] = [];

	for (const node of allNodes) {
		const blockDef = blockDefinitions[node.type];
		if (!blockDef) continue;

		const blockValues = values[node.id] || {};
		const prefetchCtx: BlockPrefetchContext = {
			blockId: node.id,
			blockType: node.type,
			...(ctx as any),
			locale: (ctx as any).locale,
		};

		// Shape 3: with + loader
		const loader = (blockDef.state as any)._prefetchLoader;
		if (typeof loader === "function") {
			const expanded = expandedData[node.id] || {};
			prefetchPromises.push(
				(async () => {
					try {
						const data = await loader({
							values: blockValues,
							expanded,
							ctx: prefetchCtx,
						});
						if (data && typeof data === "object") {
							prefetchedData[node.id] = data as Record<string, unknown>;
						}
					} catch (error) {
						prefetchLogger(ctx)?.error(
							`Block prefetch loader failed for ${node.type}:${node.id}:`,
							error,
						);
						prefetchedData[node.id] = { _error: "Prefetch failed" };
					}
				})(),
			);
		}
		// Shape 1: pure function prefetch
		else if (blockDef.state.prefetch) {
			prefetchPromises.push(
				(async () => {
					try {
						const data = await blockDef.executePrefetch(
							blockValues,
							prefetchCtx,
						);
						prefetchedData[node.id] = data;
					} catch (error) {
						prefetchLogger(ctx)?.error(
							`Block prefetch failed for ${node.type}:${node.id}:`,
							error,
						);
						prefetchedData[node.id] = { _error: "Prefetch failed" };
					}
				})(),
			);
		}
	}

	await Promise.all(prefetchPromises);
	return prefetchedData;
}

/**
 * Process blocks prefetch for a document.
 * Finds all blocks fields in the document and processes them.
 *
 * @param doc - The document containing blocks fields
 * @param fieldDefinitions - Field definitions to identify blocks fields
 * @param blockDefinitions - Registered block definitions
 * @param ctx - Prefetch context
 * @returns The document with blocks prefetch data attached
 */
export async function processDocumentBlocksPrefetch<
	T extends Record<string, unknown>,
>(
	doc: T,
	fieldDefinitions: Record<
		string,
		{ _state: { customType?: string; type: string } }
	>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<T> {
	if (!doc || !blockDefinitions || Object.keys(blockDefinitions).length === 0) {
		return doc;
	}

	const result: Record<string, unknown> = { ...doc };

	// Find all blocks fields and process them
	for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
		const fieldType = fieldDef?._state?.customType ?? fieldDef?._state?.type;

		if (fieldType === "blocks" && result[fieldName]) {
			result[fieldName] = await processBlocksDocument(
				result[fieldName] as BlocksDocument,
				blockDefinitions,
				ctx,
			);
		}
	}

	return result as T;
}

export function createBlocksPrefetchHook() {
	return async (ctx: {
		data: Record<string, unknown>;
		app: any;
		db: unknown;
		session?: unknown | null;
		locale?: string;
		accessMode?: string;
		stage?: string;
		collections?: unknown;
		globals?: unknown;
	}) => {
		const blocks = ctx.app?.state?.blocks;
		if (!blocks || Object.keys(blocks).length === 0) {
			return;
		}

		// Process any field that looks like blocks data
		for (const [key, value] of Object.entries(ctx.data)) {
			if (isBlocksDocument(value)) {
				ctx.data[key] = await processBlocksDocument(value, blocks, {
					app: ctx.app,
					db: ctx.db,
					session: ctx.session,
					locale: ctx.locale,
					accessMode: ctx.accessMode,
					stage: ctx.stage,
					collections: ctx.collections ?? ctx.app?.collections,
					globals: ctx.globals ?? ctx.app?.globals,
				});
			}
		}
	};
}

/**
 * Check if a value is a blocks document.
 */
function isBlocksDocument(value: unknown): value is BlocksDocument {
	if (!value || typeof value !== "object") return false;
	const doc = value as Record<string, unknown>;
	return (
		Array.isArray(doc._tree) &&
		typeof doc._values === "object" &&
		doc._values !== null
	);
}
