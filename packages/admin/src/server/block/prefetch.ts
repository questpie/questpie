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

import type { RegisteredApp } from "questpie";
import type { BlocksDocument } from "../fields/blocks.js";
import type {
	AnyBlockDefinition,
	BlockPrefetchContext,
} from "./block-builder.js";

/**
 * Context for blocks prefetch processing.
 * Typed via Register.app when registered.
 */
export interface BlocksPrefetchContext {
	/** CMS app instance — typed via Register.app */
	app: RegisteredApp;
	/** Database client */
	db: unknown;
	/** Current locale */
	locale?: string;
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
	// Key: "collection:nestedWithHash" to separate different with configs
	const expansionsByCollection = new Map<
		string,
		{
			ids: Set<string>;
			targets: ExpansionTarget[];
			nestedWith?: Record<string, unknown>;
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

			// Group by collection + nested with config
			const groupKey = nestedWith
				? `${targetCollection}:${JSON.stringify(nestedWith)}`
				: targetCollection;

			if (!expansionsByCollection.has(groupKey)) {
				expansionsByCollection.set(groupKey, {
					ids: new Set(),
					targets: [],
					nestedWith,
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
		async ([groupKey, { ids, nestedWith }]) => {
			// Extract collection name from group key
			const collection = groupKey.includes(":")
				? groupKey.slice(0, groupKey.indexOf(":"))
				: groupKey;

			try {
				const appApi = (ctx.app as any)?.api?.collections?.[collection];
				if (!appApi?.find) {
					console.warn(
						`[prefetch] Collection "${collection}" not found on app API, skipping`,
					);
					return;
				}

				// Pass nested `with` through to collection's find — reuses existing
				// relation resolution machinery (same as find({ with: { ... } }))
				const result = await appApi.find({
					where: { id: { in: [...ids] } },
					limit: ids.size,
					...(nestedWith ? { with: nestedWith } : {}),
				});

				const recordMap = new Map<string, unknown>();
				for (const doc of result?.docs || []) {
					if (doc && typeof doc === "object" && "id" in doc) {
						recordMap.set((doc as any).id, doc);
					}
				}
				fetchedByGroup.set(groupKey, recordMap);
			} catch (error) {
				console.error(
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

			const blockVal = (values[blockId] || {})[fieldName];
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

	// Step 1: Expand declared `with` fields (batch across all blocks)
	const expandedData = await expandDeclaredFields(
		allNodes,
		blocks._values,
		blockDefinitions,
		ctx,
	);

	// Step 2: Execute prefetch functions and loaders
	const prefetchedData = await executePrefetchFunctions(
		allNodes,
		blocks._values,
		blockDefinitions,
		ctx,
		expandedData,
	);

	// Step 3: Merge expanded + prefetched (prefetched overrides on conflict)
	const mergedData: Record<string, Record<string, unknown>> = {};
	const allBlockIds = new Set([
		...Object.keys(expandedData),
		...Object.keys(prefetchedData),
	]);

	for (const blockId of allBlockIds) {
		mergedData[blockId] = {
			...(expandedData[blockId] || {}),
			...(prefetchedData[blockId] || {}),
		};
	}

	return {
		...blocks,
		_data: mergedData,
	};
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
			app: ctx.app,
			db: ctx.db,
			locale: ctx.locale,
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
						console.error(
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
						console.error(
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
	fieldDefinitions: Record<string, { state: { config: { type?: string } } }>,
	blockDefinitions: Record<string, AnyBlockDefinition>,
	ctx: BlocksPrefetchContext,
): Promise<T> {
	if (!doc || !blockDefinitions || Object.keys(blockDefinitions).length === 0) {
		return doc;
	}

	const result: Record<string, unknown> = { ...doc };

	// Find all blocks fields and process them
	for (const [fieldName, fieldDef] of Object.entries(fieldDefinitions)) {
		const fieldType = fieldDef?.state?.config?.type;

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

/**
 * Create an afterRead hook for processing blocks prefetch.
 * This hook can be added to collections that have blocks fields.
 *
 * @example
 * ```ts
 * import { createBlocksPrefetchHook } from "@questpie/admin/server";
 *
 * const pages = q.collection("pages")
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     content: f.blocks({ allowedBlocks: ["hero", "text"] }),
 *   }))
 *   .hooks({
 *     afterRead: createBlocksPrefetchHook(),
 *   });
 * ```
 */
export function createBlocksPrefetchHook() {
	return async (ctx: {
		data: Record<string, unknown>;
		app: any;
		db: unknown;
		locale?: string;
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
					locale: ctx.locale,
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
