import {
	PGlite,
	type Extensions,
	type PGliteOptions,
} from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import {
	runWithContext,
	type Principal,
	type RequestContext,
	type RuntimeConfig,
} from "questpie/types";

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
	createContext(options?: TestContextInput): Promise<RequestContext>;
	waitForInit(): Promise<void>;
	destroy(): Promise<void>;
}

interface TestContextInput {
	session?: unknown | null;
	principal?: Principal;
	accessMode?: "system" | "user";
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

type AppOf<TFactory extends GeneratedAppFactory<TestAppLifecycle>> = Awaited<
	ReturnType<TFactory>
>;

type SessionOf<TFactory> =
	TFactory extends GeneratedAppFactory<TestAppLifecycle, infer TSession>
		? TSession
		: never;

type UserOf<TFactory> =
	SessionOf<TFactory> extends { user: infer TUser } ? TUser : never;

type SessionRecordOf<TFactory> =
	SessionOf<TFactory> extends {
		session: infer TSessionRecord;
	}
		? TSessionRecord
		: never;

type DefaultedUserKey = "emailVerified" | "createdAt" | "updatedAt";
type StandardSessionKey =
	| "id"
	| "userId"
	| "token"
	| "expiresAt"
	| "createdAt"
	| "updatedAt"
	| "ipAddress"
	| "userAgent";

type RequiredKeys<T> = {
	[K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

export type TestUserSeed<TFactory> =
	UserOf<TFactory> extends infer TUser
		? TUser extends object
			? Omit<TUser, Extract<keyof TUser, DefaultedUserKey>> &
					Partial<Pick<TUser, Extract<keyof TUser, DefaultedUserKey>>>
			: never
		: never;

type CanBuildStandardSession<TFactory> =
	Exclude<
		RequiredKeys<SessionRecordOf<TFactory>>,
		StandardSessionKey
	> extends never
		? true
		: false;

export type TestUserActorInput<TFactory> =
	| { session: SessionOf<TFactory>; user?: never }
	| (CanBuildStandardSession<TFactory> extends true
			? { user: TestUserSeed<TFactory>; session?: never }
			: never);

export interface TestOAuthActorInput<TFactory> {
	session: SessionOf<TFactory>;
	clientId: string;
	scopes: readonly string[];
	tokenId: string;
}

type ActorKind = "anonymous" | "user" | "oauth" | "system";

type ActorSession<TFactory, TKind extends ActorKind> = TKind extends
	| "user"
	| "oauth"
	? SessionOf<TFactory>
	: TKind extends "anonymous"
		? null
		: undefined;

export interface TestActorRunContext<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
	TKind extends ActorKind,
> {
	readonly app: AppOf<TFactory>;
	readonly context: Omit<
		Awaited<ReturnType<AppOf<TFactory>["createContext"]>>,
		"session"
	> & { session: ActorSession<TFactory, TKind> };
}

export interface TestActor<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
	TKind extends ActorKind = ActorKind,
> {
	readonly kind: TKind;
	run<TResult>(
		callback: (
			value: TestActorRunContext<TFactory, TKind>,
		) => TResult | Promise<TResult>,
	): Promise<TResult>;
}

export interface TestApp<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
> {
	readonly app: AppOf<TFactory>;
	anonymous(): TestActor<TFactory, "anonymous">;
	actor(input: TestUserActorInput<TFactory>): TestActor<TFactory, "user">;
	oauth(input: TestOAuthActorInput<TFactory>): TestActor<TFactory, "oauth">;
	system(): TestActor<TFactory, "system">;
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
		anonymous: () =>
			createActor(concreteApp, "anonymous", () => ({
				session: null,
				accessMode: "user",
			})),
		actor: (input) =>
			createActor(concreteApp, "user", () => ({
				session: "session" in input ? input.session : createSession(input.user),
				accessMode: "user",
			})),
		oauth: (input) =>
			createActor(concreteApp, "oauth", () => ({
				session: input.session,
				principal: createOAuthPrincipal(input),
			})),
		system: () =>
			createActor(concreteApp, "system", () => ({ accessMode: "system" })),
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

function createActor<
	TFactory extends GeneratedAppFactory<TestAppLifecycle>,
	TKind extends TestActor<TFactory>["kind"],
>(
	app: AppOf<TFactory>,
	kind: TKind,
	contextInput: () => TestContextInput,
): TestActor<TFactory, TKind> {
	return {
		kind,
		async run(callback) {
			const context = (await app.createContext(
				contextInput(),
			)) as TestActorRunContext<TFactory, TKind>["context"];
			const requestContext = context as RequestContext;
			return runWithContext(
				{
					app,
					db: requestContext.db,
					session: requestContext.session,
					principal: requestContext.principal,
					actor: requestContext.actor,
					locale: requestContext.locale,
					accessMode: requestContext.accessMode,
					stage: requestContext.stage,
					requestId: requestContext.requestId,
					traceId: requestContext.traceId,
					"~contextExtensions": requestContext["~contextExtensions"],
				},
				() => callback({ app, context }),
			);
		},
	};
}

function createSession<TFactory>(
	userSeed: TestUserSeed<TFactory>,
): SessionOf<TFactory> {
	const now = new Date("2020-01-01T00:00:00.000Z");
	const seed = userSeed as Record<string, unknown>;
	const user = {
		...seed,
		emailVerified: seed.emailVerified ?? true,
		createdAt: seed.createdAt ?? now,
		updatedAt: seed.updatedAt ?? now,
	};
	const userId = String(seed.id);

	return {
		user,
		session: {
			id: `${userId}-session`,
			userId,
			token: `${userId}-token`,
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			createdAt: now,
			updatedAt: now,
		},
	} as SessionOf<TFactory>;
}

function createOAuthPrincipal<TFactory>(
	input: TestOAuthActorInput<TFactory>,
): Principal {
	const session = input.session as {
		user: Extract<Principal, { kind: "oauth" }>["user"];
	};
	return {
		kind: "oauth",
		user: session.user,
		clientId: input.clientId,
		scopes: [...input.scopes],
		tokenId: input.tokenId,
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
