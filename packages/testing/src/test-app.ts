import {
	PGlite,
	type Extensions,
	type PGliteOptions,
} from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { RuntimeConfig } from "questpie/types";

import type { GeneratedAppFactory } from "./index.js";
import { SilentMailAdapter } from "./silent-mail-adapter.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_APP_URL = "http://questpie.test";
const DEFAULT_SECRET = "questpie-testing-secret-at-least-32-characters";

class SilentLoggerAdapter {
	debug(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	error(_message: string, ..._args: unknown[]): void {}
	child(_bindings: Record<string, unknown>): SilentLoggerAdapter {
		return this;
	}
}

export type TestAppSetupPhase = "database" | "app" | "migrations" | "readiness";

export class TestAppSetupError extends Error {
	constructor(
		public readonly phase: TestAppSetupPhase,
		cause: unknown,
	) {
		super(`Failed to set up QUESTPIE test app during ${phase}`, { cause });
		this.name = "TestAppSetupError";
	}
}

export class TestAppCleanupError extends Error {
	constructor(public readonly errors: readonly unknown[]) {
		super(`Failed to clean up ${errors.length} QUESTPIE test resource(s)`);
		this.name = "TestAppCleanupError";
	}
}

export interface TestAppLifecycle {
	readonly migrations: { up(): Promise<void> };
	waitForInit(): Promise<void>;
	destroy(): Promise<void>;
}

export interface PGliteTestDatabaseOptions {
	kind: "pglite";
	/** Existing clients remain caller-owned by default. */
	client?: PGlite;
	/** Transfer an existing client to the harness for disposal. */
	ownership?: "caller" | "harness";
	/** PGlite extension modules that must be loaded before migrations run. */
	extensions?: Extensions;
}

export interface TestAppOptions<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
> {
	createApp: TFactory;
	database?: PGliteTestDatabaseOptions;
	runtime?: TestRuntimeOptions;
	timeoutMs?: number;
}

export type TestRuntimeOptions = Omit<
	Partial<RuntimeConfig>,
	"app" | "db" | "secret"
> & {
	app?: { url: string };
	secret?: string;
};

type AppOf<TFactory> =
	TFactory extends GeneratedAppFactory<infer TApp> ? TApp : never;

export interface TestApp<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
> {
	readonly app: AppOf<TFactory>;
	dispose(): Promise<void>;
}

export async function createTestApp<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
>(options: TestAppOptions<TFactory>): Promise<TestApp<TFactory>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let phase: TestAppSetupPhase = "database";
	let database: PGlite | undefined;
	let app: TestAppLifecycle | undefined;
	let ownsDatabase = false;

	try {
		const databaseOptions = options.database ?? { kind: "pglite" as const };
		if (databaseOptions.client && databaseOptions.extensions) {
			throw new Error(
				"PGlite extensions must be loaded when the client is created; omit extensions for an existing client",
			);
		}

		if (databaseOptions.client) {
			database = databaseOptions.client;
			ownsDatabase = databaseOptions.ownership === "harness";
		} else {
			const pgliteOptions: PGliteOptions = {
				extensions: { pg_trgm, ...databaseOptions.extensions },
			};
			database = await PGlite.create(pgliteOptions);
			ownsDatabase = true;
		}

		const runtime: RuntimeConfig = {
			...options.runtime,
			app: options.runtime?.app ?? { url: DEFAULT_APP_URL },
			db: { pglite: database },
			secret: options.runtime?.secret ?? DEFAULT_SECRET,
			email: options.runtime?.email ?? { adapter: new SilentMailAdapter() },
			logger: options.runtime?.logger ?? { adapter: new SilentLoggerAdapter() },
		};

		phase = "app";
		app = await options.createApp(runtime);

		phase = "readiness";
		await withTimeout(app.waitForInit(), timeoutMs, phase);

		phase = "migrations";
		await withTimeout(app.migrations.up(), timeoutMs, phase);
	} catch (cause) {
		await cleanupSetupFailure(app, database, ownsDatabase);
		throw new TestAppSetupError(phase, cause);
	}

	const concreteApp = app as AppOf<TFactory>;
	const concreteDatabase = database;
	let disposePromise: Promise<void> | undefined;

	return {
		app: concreteApp,
		dispose() {
			disposePromise ??= disposeResources(
				concreteApp,
				concreteDatabase,
				ownsDatabase,
			);
			return disposePromise;
		},
	};
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	phase: TestAppSetupPhase,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${phase} timed out after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function cleanupSetupFailure(
	app: TestAppLifecycle | undefined,
	database: PGlite | undefined,
	ownsDatabase: boolean,
): Promise<void> {
	if (app) await Promise.allSettled([app.destroy()]);
	if (database && ownsDatabase) await Promise.allSettled([database.close()]);
}

async function disposeResources(
	app: TestAppLifecycle,
	database: PGlite,
	ownsDatabase: boolean,
): Promise<void> {
	const errors: unknown[] = [];
	try {
		await app.destroy();
	} catch (error) {
		errors.push(error);
	}
	if (ownsDatabase) {
		try {
			await database.close();
		} catch (error) {
			errors.push(error);
		}
	}

	if (errors.length > 0) throw new TestAppCleanupError(errors);
}
