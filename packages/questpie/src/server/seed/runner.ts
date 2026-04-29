import { sql } from "drizzle-orm";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import { runWithContext } from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import type {
	ResetSeedsOptions,
	RunSeedsOptions,
	Seed,
	SeedCategory,
	SeedContext,
	SeedRecord,
	SeedStatus,
} from "./types.js";

export type SeedRunnerOptions = {
	/** Suppress info/warn logs */
	silent?: boolean;
};

/**
 * Seed runner service.
 *
 * Manages seed execution, undo, and status tracking.
 * Stores seed history in `questpie_seeds` table.
 * Resolves dependency order via topological sort.
 */
export class SeedRunner {
	private tableName = "questpie_seeds";
	readonly silent: boolean;

	constructor(
		private readonly app: Questpie<any>,
		options: SeedRunnerOptions = {},
	) {
		this.silent = options.silent ?? this.readSilentEnv();
	}

	private readSilentEnv(): boolean {
		const value = process.env.QUESTPIE_SEEDS_SILENT;
		const isTestEnv = process.env.NODE_ENV === "test";
		if (isTestEnv) return true;
		if (!value) return false;
		return ["1", "true", "yes"].includes(value.toLowerCase());
	}

	private log(message: string): void {
		if (!this.silent) console.log(message);
	}

	private warn(message: string): void {
		if (!this.silent) console.warn(message);
	}

	/**
	 * Ensure the seeds tracking table exists.
	 */
	async ensureSeedsTable(): Promise<void> {
		await this.app.db.execute(
			sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(this.tableName)} (
				id TEXT PRIMARY KEY,
				category TEXT NOT NULL,
				executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
		);
	}

	/**
	 * Run seeds with optional filtering.
	 * Resolves dependencies and skips already-executed seeds (unless force=true).
	 */
	async run(seeds: Seed[], options: RunSeedsOptions = {}): Promise<void> {
		await this.ensureSeedsTable();

		// Filter by category
		let filtered = seeds;
		if (options.category) {
			const cats = Array.isArray(options.category)
				? options.category
				: [options.category];
			filtered = seeds.filter((s) => cats.includes(s.category));
		}

		// Filter by specific IDs
		if (options.only?.length) {
			const onlySet = new Set(options.only);
			filtered = filtered.filter((s) => onlySet.has(s.id));
		}

		// Resolve dependency order (topological sort)
		filtered = this.resolveDependencyOrder(filtered, seeds);

		// Get already-executed seeds
		const executed = await this.getExecutedSeeds();
		const executedIds = new Set(executed.map((s) => s.id));

		// Skip already-executed unless force
		const pending = options.force
			? filtered
			: filtered.filter((s) => !executedIds.has(s.id));

		if (pending.length === 0) {
			this.log("✅ No pending seeds");
			return;
		}

		// Validate mode: wrap everything in a transaction and rollback
		if (options.validate) {
			await this.runValidate(pending, executedIds);
			return;
		}

		this.log(`🌱 Running ${pending.length} seed(s)...`);

		const reqCtx = await this.app.createContext({ accessMode: "system" });
		const baseServices = extractAppServices(this.app, {
			db: this.app.db,
			session: (reqCtx as any).session,
		});

		for (const seed of pending) {
			this.log(
				`  🌱 Running seed: ${seed.id}${seed.description ? ` (${seed.description})` : ""}`,
			);

			try {
				const seedCtx: SeedContext = {
					...baseServices,
					log: (msg: string) => this.log(`    ${msg}`),
					createContext: (opts?: {
						locale?: string;
						accessMode?: "system" | "user";
					}) =>
						this.app.createContext({
							accessMode: opts?.accessMode ?? "system",
							locale: opts?.locale,
						}),
				} as unknown as SeedContext;

				await seed.run(seedCtx);

				// Record execution (upsert for force re-runs)
				if (executedIds.has(seed.id)) {
					await this.app.db.execute(
						sql`UPDATE ${sql.identifier(this.tableName)} SET executed_at = CURRENT_TIMESTAMP WHERE id = ${seed.id}`,
					);
				} else {
					await this.app.db.execute(
						sql`INSERT INTO ${sql.identifier(this.tableName)} (id, category) VALUES (${seed.id}, ${seed.category})`,
					);
				}

				this.log(`  ✅ Seed completed: ${seed.id}`);
			} catch (error) {
				this.log(
					`  ❌ Seed failed: ${seed.id} — ${error instanceof Error ? error.message : String(error)}`,
				);
				throw error;
			}
		}

		this.log("✅ All seeds completed successfully");
	}

	/**
	 * Validate mode: run seeds inside a transaction, then rollback.
	 * Checks seed compatibility without persisting any data.
	 */
	private async runValidate(
		pending: Seed[],
		_executedIds: Set<string>,
	): Promise<void> {
		this.log(`🔍 Validating ${pending.length} seed(s) (dry-run)...`);

		const reqCtx = await this.app.createContext({ accessMode: "system" });

		// Use a sentinel error to force rollback
		const ROLLBACK_SENTINEL = Symbol("validate-rollback");

		try {
			await withTransaction(this.app.db, async (tx: any) => {
				// Create a temporary context with tx db
				const txServices = extractAppServices(this.app, {
					db: tx,
					session: (reqCtx as any).session,
					locale: reqCtx.locale,
				});

				for (const seed of pending) {
					this.log(`  🔍 Validating seed: ${seed.id}`);

					const seedCtx: SeedContext = {
						...txServices,
						log: (msg: string) => this.log(`    ${msg}`),
						createContext: (opts?: {
							locale?: string;
							accessMode?: "system" | "user";
						}) =>
							this.app.createContext({
								accessMode: opts?.accessMode ?? "system",
								locale: opts?.locale,
								db: tx,
							}),
					} as unknown as SeedContext;

					await runWithContext(
						{
							app: this.app,
							session: (reqCtx as any).session,
							db: tx,
							locale: reqCtx.locale,
							accessMode: "system",
							stage: reqCtx.stage,
						},
						() => seed.run(seedCtx),
					);
					this.log(`  ✅ Seed valid: ${seed.id}`);
				}

				// Force rollback — throw sentinel
				throw ROLLBACK_SENTINEL;
			});
		} catch (error) {
			if (error === ROLLBACK_SENTINEL) {
				this.log("✅ All seeds validated successfully (no data persisted)");
				return;
			}
			// Re-throw real errors
			throw error;
		}
	}

	/**
	 * Undo seeds (reverse order).
	 * Only undoes seeds that have an `undo` function and are tracked as executed.
	 */
	async undo(
		seeds: Seed[],
		options: {
			category?: SeedCategory | SeedCategory[];
			only?: string[];
		} = {},
	): Promise<void> {
		await this.ensureSeedsTable();

		const executed = await this.getExecutedSeeds();
		const executedIds = new Set(executed.map((s) => s.id));

		let toUndo = seeds.filter(
			(s) => executedIds.has(s.id) && s.undo !== undefined,
		);

		if (options.category) {
			const cats = Array.isArray(options.category)
				? options.category
				: [options.category];
			toUndo = toUndo.filter((s) => cats.includes(s.category));
		}

		if (options.only?.length) {
			const onlySet = new Set(options.only);
			toUndo = toUndo.filter((s) => onlySet.has(s.id));
		}

		// Reverse order for undo
		toUndo.reverse();

		if (toUndo.length === 0) {
			this.log("ℹ️  No seeds to undo");
			return;
		}

		this.log(`🔄 Undoing ${toUndo.length} seed(s)...`);

		const reqCtx = await this.app.createContext({ accessMode: "system" });
		const baseServices = extractAppServices(this.app, {
			db: this.app.db,
			session: (reqCtx as any).session,
		});

		for (const seed of toUndo) {
			this.log(`  🔄 Undoing seed: ${seed.id}`);
			try {
				const seedCtx: SeedContext = {
					...baseServices,
					log: (msg: string) => this.log(`    ${msg}`),
					createContext: (opts?: {
						locale?: string;
						accessMode?: "system" | "user";
					}) =>
						this.app.createContext({
							accessMode: opts?.accessMode ?? "system",
							locale: opts?.locale,
						}),
				} as unknown as SeedContext;

				await seed.undo?.(seedCtx);

				await this.app.db.execute(
					sql`DELETE FROM ${sql.identifier(this.tableName)} WHERE id = ${seed.id}`,
				);

				this.log(`  ✅ Undo completed: ${seed.id}`);
			} catch (error) {
				console.error(`  ❌ Undo failed: ${seed.id}`, error);
				throw error;
			}
		}

		this.log("✅ All seeds undone successfully");
	}

	/**
	 * Reset seed tracking (remove records from questpie_seeds).
	 * Does NOT undo the data — just clears the tracking table.
	 */
	async reset(options: ResetSeedsOptions = {}): Promise<void> {
		await this.ensureSeedsTable();

		if (options.only?.length) {
			const ids = options.only;
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.tableName)} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`))})`,
			);
			this.log(`✅ Seed tracking reset for: ${options.only.join(", ")}`);
		} else {
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.tableName)}`,
			);
			this.log("✅ Seed tracking reset");
		}
	}

	/**
	 * Get seed status — executed and pending seeds.
	 */
	async status(seeds: Seed[]): Promise<SeedStatus> {
		await this.ensureSeedsTable();

		const executed = await this.getExecutedSeeds();
		const executedIds = new Set(executed.map((s) => s.id));

		const pending = seeds
			.filter((s) => !executedIds.has(s.id))
			.map((s) => ({
				id: s.id,
				category: s.category,
				description: s.description,
			}));

		this.log("\n📊 Seed Status:\n");
		this.log(`Executed: ${executed.length}`);
		this.log(`Pending: ${pending.length}\n`);

		if (executed.length > 0) {
			this.log("✅ Executed seeds:");
			for (const record of executed) {
				this.log(
					`  - ${record.id} [${record.category}] (${record.executedAt.toISOString()})`,
				);
			}
			this.log("");
		}

		if (pending.length > 0) {
			this.log("⏳ Pending seeds:");
			for (const p of pending) {
				this.log(
					`  - ${p.id} [${p.category}]${p.description ? ` — ${p.description}` : ""}`,
				);
			}
			this.log("");
		}

		return { pending, executed };
	}

	/**
	 * Get all executed seeds from the tracking table.
	 */
	private async getExecutedSeeds(): Promise<SeedRecord[]> {
		const result: any = await this.app.db.execute(
			sql.raw(
				`SELECT id, category, executed_at FROM ${this.tableName} ORDER BY executed_at ASC`,
			),
		);

		return (result.rows || result || []).map((row: any) => ({
			id: row.id,
			category: row.category as SeedCategory,
			executedAt: new Date(row.executed_at),
		}));
	}

	/**
	 * Topological sort of seeds based on dependsOn.
	 * Ensures dependencies run first. Auto-includes dependencies even if not in original filter.
	 */
	private resolveDependencyOrder(toRun: Seed[], allSeeds: Seed[]): Seed[] {
		const seedMap = new Map(allSeeds.map((s) => [s.id, s]));
		const toRunIds = new Set(toRun.map((s) => s.id));
		const visited = new Set<string>();
		const sorted: Seed[] = [];

		const visit = (seed: Seed) => {
			if (visited.has(seed.id)) return;
			visited.add(seed.id);

			for (const depId of seed.dependsOn || []) {
				const dep = seedMap.get(depId);
				if (dep) {
					// Include dependency even if not in original toRun set
					if (!toRunIds.has(depId)) toRunIds.add(depId);
					visit(dep);
				} else {
					this.warn(
						`⚠️  Seed "${seed.id}" depends on "${depId}" which was not found`,
					);
				}
			}

			if (toRunIds.has(seed.id)) {
				sorted.push(seed);
			}
		};

		for (const seed of toRun) {
			visit(seed);
		}

		return sorted;
	}
}
