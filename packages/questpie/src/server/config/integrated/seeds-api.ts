import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import {
	type ResetSeedsOptions,
	type RunSeedsOptions,
	SeedRunner,
	type SeedStatus,
} from "#questpie/server/seed/index.js";

/**
 * Programmatic seeds API
 *
 * Provides access to seed operations for use in code, tests, CI, and startup.
 *
 * @example
 * ```ts
 * // Run all pending seeds
 * await app.seeds.run()
 *
 * // Run only required seeds
 * await app.seeds.run({ category: "required" })
 *
 * // Run specific seed
 * await app.seeds.run({ only: ["adminUser"] })
 *
 * // Force re-run
 * await app.seeds.run({ force: true })
 *
 * // Validate (dry-run)
 * await app.seeds.run({ validate: true })
 *
 * // Get status
 * const status = await app.seeds.status()
 *
 * // Undo dev seeds
 * await app.seeds.undo({ category: "dev" })
 *
 * // Reset tracking
 * await app.seeds.reset()
 * await app.seeds.reset({ only: ["pages"] })
 * ```
 */
export class QuestpieSeedsAPI<TConfig extends QuestpieConfig = QuestpieConfig> {
	private readonly runner: SeedRunner;

	constructor(private readonly app: Questpie<TConfig>) {
		this.runner = new SeedRunner(app);
	}

	/** Run pending seeds */
	async run(options: RunSeedsOptions = {}): Promise<void> {
		const seeds = this.app.config.seeds?.seeds || [];
		await this.runner.run(seeds, options);
	}

	/** Undo executed seeds */
	async undo(
		options: { category?: RunSeedsOptions["category"]; only?: string[] } = {},
	): Promise<void> {
		const seeds = this.app.config.seeds?.seeds || [];
		await this.runner.undo(seeds, options);
	}

	/** Reset seed tracking table */
	async reset(options: ResetSeedsOptions = {}): Promise<void> {
		await this.runner.reset(options);
	}

	/** Get seed status */
	async status(): Promise<SeedStatus> {
		const seeds = this.app.config.seeds?.seeds || [];
		return this.runner.status(seeds);
	}
}
