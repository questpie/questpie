export interface CleanupFailure {
	name: string;
	cause: unknown;
}

/**
 * Every step that failed, not just the first. A run that leaked a database and
 * a port needs to say both, because fixing one and rerunning to discover the
 * other is how a leak survives three CI runs.
 */
export class CleanupError extends Error {
	constructor(public readonly failures: readonly CleanupFailure[]) {
		super(
			`Cleanup failed for ${failures.length} resource(s): ${failures
				.map((failure) => failure.name)
				.join(", ")}`,
		);
		this.name = "CleanupError";
	}
}

export interface Cleanup {
	/** Registers a teardown step. Steps run in reverse registration order. */
	add(name: string, step: () => void | Promise<void>): void;
	/** Runs every step once. Repeated and concurrent calls share one result. */
	run(): Promise<void>;
}

/**
 * Teardown for a harness that may have failed halfway through setup.
 *
 * Reverse order, because a resource is registered after the thing it depends
 * on: the database exists before the server that connects to it, so the server
 * has to go first. Every step runs even when an earlier one throws, because the
 * step that failed is usually the one holding the resource somebody else needs
 * to release.
 */
export function createCleanup(): Cleanup {
	const steps: { name: string; step: () => void | Promise<void> }[] = [];
	let started: Promise<void> | undefined;

	return {
		add(name, step) {
			if (started) {
				throw new Error(
					"Cleanup already ran; a resource created now would leak",
				);
			}
			steps.push({ name, step });
		},
		run() {
			started ??= (async () => {
				const failures: CleanupFailure[] = [];
				// Backwards by index rather than a reversed copy: the list is walked
				// once, and nothing here mutates the caller's registration order.
				for (let index = steps.length - 1; index >= 0; index -= 1) {
					const entry = steps[index];
					if (!entry) continue;
					try {
						await entry.step();
					} catch (cause) {
						failures.push({ name: entry.name, cause });
					}
				}
				if (failures.length > 0) throw new CleanupError(failures);
			})();
			return started;
		},
	};
}
