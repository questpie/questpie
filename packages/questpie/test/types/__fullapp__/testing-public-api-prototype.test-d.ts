import type { RequestContext, RuntimeConfig } from "questpie/types";

import type { Equal, Expect, Extends } from "../type-test-utils.js";
import type { App, AppSession, AppSessionUser } from "./.generated/index.js";

interface GeneratedAppFactory<TApp, TSession> {
	(runtime: RuntimeConfig): Promise<TApp>;
	readonly "~types"?: { session: TSession };
}

type AppOf<TFactory> =
	TFactory extends GeneratedAppFactory<infer TApp, any> ? TApp : never;
type SessionOf<TFactory> =
	TFactory extends GeneratedAppFactory<any, infer TSession> ? TSession : never;
type SessionUser<TSession> =
	NonNullable<TSession> extends { user: infer TUser } ? TUser : never;
type TestUserInput<TUser> = Omit<
	TUser,
	"emailVerified" | "createdAt" | "updatedAt"
>;

type ActorScope<TApp, TSession> = {
	app: TApp;
	context: RequestContext & {
		accessMode: "user";
		session: NonNullable<TSession>;
	};
};

interface TestActor<TApp, TSession> {
	readonly context: ActorScope<TApp, TSession>["context"];
	run<TResult>(
		callback: (scope: ActorScope<TApp, TSession>) => TResult | Promise<TResult>,
	): Promise<Awaited<TResult>>;
}

interface TestApp<TFactory extends GeneratedAppFactory<any, any>> {
	readonly app: AppOf<TFactory>;
	actor(input: {
		session: NonNullable<SessionOf<TFactory>>;
	}): TestActor<AppOf<TFactory>, SessionOf<TFactory>>;
	actor(input: {
		user: TestUserInput<SessionUser<SessionOf<TFactory>>>;
	}): TestActor<AppOf<TFactory>, SessionOf<TFactory>>;
	system(): TestActor<AppOf<TFactory>, null>;
	dispose(): Promise<void>;
}

declare function createTestApp<
	TFactory extends GeneratedAppFactory<any, any>,
>(options: {
	createApp: TFactory;
	database?: { kind: "pglite" };
	runtime?: Partial<Omit<RuntimeConfig, "db">>;
}): Promise<TestApp<TFactory>>;

declare const createAppForRuntime: GeneratedAppFactory<App, AppSession>;
declare const session: NonNullable<AppSession>;

async function proveGeneratedAppInference() {
	const testApp = await createTestApp({ createApp: createAppForRuntime });
	type _appIsExact = Expect<Equal<typeof testApp.app, App>>;

	const editor = testApp.actor({ session });
	type _sessionIsExact = Expect<
		Extends<typeof editor.context.session, NonNullable<AppSession>>
	>;
	type _userIsExact = Expect<
		Equal<typeof editor.context.session.user, AppSessionUser>
	>;
	const seededEditor = testApp.actor({
		user: {
			id: "editor-1",
			email: "editor@example.test",
			name: "Editor",
			banned: false,
		},
	});
	seededEditor.context.session.user satisfies AppSessionUser;

	const article = await editor.run(({ app, context }) =>
		app.collections.articles.create(
			{ title: "Typed", status: "draft" },
			context,
		),
	);
	article.title satisfies string;

	await editor.run(({ app, context }) =>
		app.collections.articles.create(
			// @ts-expect-error generated collection input remains authoritative
			{ title: "Invalid", status: "not-a-stage" },
			context,
		),
	);

	await testApp
		.system()
		.run(({ app, context }) => app.collections.articles.find({}, context));
	await testApp.dispose();
}

void proveGeneratedAppInference;
