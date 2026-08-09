import { sql } from "drizzle-orm";

import { withTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import { runWithContext } from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { runInFreshRequestScope } from "#questpie/server/config/request-scope.js";
import { rowsOf } from "#questpie/server/db/driver-result.js";
import { getEnv, getNodeEnv } from "#questpie/server/utils/env.js";

import { isStepSeed } from "./types.js";
import type {
	ResetSeedsOptions,
	RunSeedsOptions,
	Seed,
	SeedCategory,
	SeedContext,
	SeedRecord,
	SeedStatus,
	SimpleSeed,
	StepSeed,
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
	private stepTableName = "questpie_seed_steps";
	readonly silent: boolean;

	constructor(
		private readonly app: Questpie<any>,
		options: SeedRunnerOptions = {},
	) {
		this.silent = options.silent ?? this.readSilentEnv();
	}

	private readSilentEnv(): boolean {
		const value = getEnv("QUESTPIE_SEEDS_SILENT");
		const isTestEnv = getNodeEnv() === "test";
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

	async ensureSeedStepsTable(): Promise<void> {
		await this.app.db.execute(
			sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(this.stepTableName)} (
				seed_id TEXT NOT NULL,
				step_name TEXT NOT NULL,
				result_json JSONB NOT NULL,
				executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				UNIQUE (seed_id, step_name)
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

		if (pending.some(isStepSeed)) {
			await this.ensureSeedStepsTable();
		}

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

		for (const seed of pending) {
			this.log(
				`  🌱 Running seed: ${seed.id}${seed.description ? ` (${seed.description})` : ""}`,
			);

			try {
				if (isStepSeed(seed)) {
					await this.runStepSeed(seed, reqCtx, executedIds, options.force);
				} else {
					await this.runSimpleSeed(seed, reqCtx, executedIds);
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

	private async runSimpleSeed(
		seed: SimpleSeed,
		reqCtx: Awaited<ReturnType<Questpie<any>["createContext"]>>,
		executedIds: Set<string>,
	): Promise<void> {
		await withTransaction(this.app.db, async (tx: any) => {
			await runInFreshRequestScope(this.app, () =>
				runWithContext(
					{
						app: this.app,
						session: (reqCtx as any).session,
						db: tx,
						locale: reqCtx.locale,
						accessMode: "system",
						stage: reqCtx.stage,
					},
					() => seed.run(this.createSeedContext(reqCtx, tx)),
				),
			);

			await this.recordSeedExecution(seed, executedIds, tx);
		});
	}

	private async runStepSeed(
		seed: StepSeed,
		reqCtx: Awaited<ReturnType<Questpie<any>["createContext"]>>,
		executedIds: Set<string>,
		force?: boolean,
	): Promise<void> {
		if (force) {
			await this.clearForcedStepSeedState(seed.id);
			executedIds.delete(seed.id);
		}

		await runInFreshRequestScope(this.app, () =>
			runWithContext(
				{
					app: this.app,
					session: (reqCtx as any).session,
					db: this.app.db,
					locale: reqCtx.locale,
					accessMode: "system",
					stage: reqCtx.stage,
				},
				() =>
					seed.run({
						...this.createSeedContext(reqCtx, this.app.db),
						step: (name, fn) => this.runSeedStep(seed, name, fn, reqCtx),
					}),
			),
		);

		await this.recordSeedExecution(seed, executedIds, this.app.db);
	}

	private createSeedContext(
		reqCtx: Awaited<ReturnType<Questpie<any>["createContext"]>>,
		db: any,
	): SeedContext {
		const services = extractAppServices(this.app, {
			db,
			session: (reqCtx as any).session,
			locale: reqCtx.locale,
		});

		return {
			...services,
			log: (msg: string) => this.log(`    ${msg}`),
		} as unknown as SeedContext;
	}

	private async recordSeedExecution(
		seed: Seed,
		executedIds: Set<string>,
		db: any,
	): Promise<void> {
		await db.execute(
			sql`INSERT INTO ${sql.identifier(this.tableName)} (id, category)
				VALUES (${seed.id}, ${seed.category})
				ON CONFLICT (id) DO UPDATE SET
					category = EXCLUDED.category,
					executed_at = CURRENT_TIMESTAMP`,
		);
		executedIds.add(seed.id);
	}

	private async runSeedStep<T>(
		seed: StepSeed,
		name: string,
		fn: (ctx: SeedContext) => T | Promise<T>,
		reqCtx: Awaited<ReturnType<Questpie<any>["createContext"]>>,
		db: any = this.app.db,
	): Promise<T> {
		const completed = await this.getCompletedSeedStep(seed.id, name, db);
		if (completed.found) return completed.value as T;

		return withTransaction(db, async (tx: any) => {
			const value = await runWithContext(
				{
					app: this.app,
					session: (reqCtx as any).session,
					db: tx,
					locale: reqCtx.locale,
					accessMode: "system",
					stage: reqCtx.stage,
				},
				() => fn(this.createSeedContext(reqCtx, tx)),
			);

			await this.recordSeedStep(seed.id, name, value, tx);
			return value;
		});
	}

	private async getCompletedSeedStep(
		seedId: string,
		stepName: string,
		db: any = this.app.db,
	): Promise<{ found: true; value: unknown } | { found: false }> {
		const result: any = await db.execute(
			sql`SELECT result_json FROM ${sql.identifier(this.stepTableName)} WHERE seed_id = ${seedId} AND step_name = ${stepName} LIMIT 1`,
		);
		const row = rowsOf<any>(result)[0];
		if (!row) return { found: false };

		return {
			found: true,
			value: this.decodeStepResult(row.result_json),
		};
	}

	private async recordSeedStep(
		seedId: string,
		stepName: string,
		value: unknown,
		db: any,
	): Promise<void> {
		await db.execute(
			sql`INSERT INTO ${sql.identifier(this.stepTableName)} (seed_id, step_name, result_json)
				VALUES (${seedId}, ${stepName}, ${this.encodeStepResult(value)}::jsonb)
				ON CONFLICT (seed_id, step_name) DO UPDATE SET
					result_json = EXCLUDED.result_json,
					executed_at = CURRENT_TIMESTAMP`,
		);
	}

	private async clearForcedStepSeedState(seedId: string): Promise<void> {
		await withTransaction(this.app.db, async (tx: any) => {
			await this.clearSeedSteps(seedId, tx);
			await this.clearSeedRecord(seedId, tx);
		});
	}

	private async clearSeedSteps(
		seedId: string,
		db: any = this.app.db,
	): Promise<void> {
		await db.execute(
			sql`DELETE FROM ${sql.identifier(this.stepTableName)} WHERE seed_id = ${seedId}`,
		);
	}

	private async clearSeedRecord(
		seedId: string,
		db: any = this.app.db,
	): Promise<void> {
		await db.execute(
			sql`DELETE FROM ${sql.identifier(this.tableName)} WHERE id = ${seedId}`,
		);
	}

	private encodeStepResult(value: unknown): string {
		return JSON.stringify({ value });
	}

	private decodeStepResult(value: unknown): unknown {
		if (value == null) return undefined;

		let decoded: unknown;
		try {
			decoded = typeof value === "string" ? JSON.parse(value) : value;
		} catch {
			return undefined;
		}

		if (
			decoded &&
			typeof decoded === "object" &&
			Object.prototype.hasOwnProperty.call(decoded, "value")
		) {
			return (decoded as { value?: unknown }).value;
		}
		return undefined;
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
				for (const seed of pending) {
					this.log(`  🔍 Validating seed: ${seed.id}`);

					await runInFreshRequestScope(this.app, () =>
						runWithContext(
							{
								app: this.app,
								session: (reqCtx as any).session,
								db: tx,
								locale: reqCtx.locale,
								accessMode: "system",
								stage: reqCtx.stage,
							},
							() => {
								const seedCtx = this.createSeedContext(reqCtx, tx);
								return isStepSeed(seed)
									? seed.run({
											...seedCtx,
											step: (name, fn) =>
												this.runSeedStep(seed, name, fn, reqCtx, tx),
										})
									: seed.run(seedCtx);
							},
						),
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
		if (seeds.some(isStepSeed)) {
			await this.ensureSeedStepsTable();
		}

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

		for (const seed of toUndo) {
			this.log(`  🔄 Undoing seed: ${seed.id}`);
			try {
				await withTransaction(this.app.db, async (tx: any) => {
					await runInFreshRequestScope(this.app, () =>
						runWithContext(
							{
								app: this.app,
								session: (reqCtx as any).session,
								db: tx,
								locale: reqCtx.locale,
								accessMode: "system",
								stage: reqCtx.stage,
							},
							() => seed.undo?.(this.createSeedContext(reqCtx, tx)),
						),
					);

					if (isStepSeed(seed)) {
						await this.clearSeedSteps(seed.id, tx);
					}

					await this.clearSeedRecord(seed.id, tx);
				});

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
		await this.ensureSeedStepsTable();

		if (options.only?.length) {
			const ids = options.only;
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.tableName)} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`))})`,
			);
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.stepTableName)} WHERE seed_id IN (${sql.join(ids.map((id) => sql`${id}`))})`,
			);
			this.log(`✅ Seed tracking reset for: ${options.only.join(", ")}`);
		} else {
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.tableName)}`,
			);
			await this.app.db.execute(
				sql`DELETE FROM ${sql.identifier(this.stepTableName)}`,
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
			sql`SELECT id, category, executed_at FROM ${sql.identifier(this.tableName)} ORDER BY executed_at ASC`,
		);

		return rowsOf<any>(result).map((row: any) => ({
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
		const visiting = new Set<string>();
		const sorted: Seed[] = [];

		const visit = (seed: Seed) => {
			if (visited.has(seed.id)) return;
			if (visiting.has(seed.id)) {
				throw new Error(`Circular seed dependency detected at "${seed.id}"`);
			}
			visiting.add(seed.id);

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

			visiting.delete(seed.id);
			visited.add(seed.id);
		};

		for (const seed of toRun) {
			visit(seed);
		}

		return sorted;
	}
}
