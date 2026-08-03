import type {
	GeneratedAppFactory,
	TestApp,
	TestAppLifecycle,
} from "../src/index.js";

type StandardSession = {
	user: {
		id: string;
		email: string;
		name: string;
		tenantId: string;
		emailVerified: boolean;
		createdAt: Date;
		updatedAt: Date;
	};
	session: {
		id: string;
		userId: string;
		token: string;
		expiresAt: Date;
		createdAt: Date;
		updatedAt: Date;
	};
};

interface TypedApp extends TestAppLifecycle {
	collections: {
		posts: { find(): Promise<{ docs: Array<{ id: string }> }> };
	};
	globals: { settings: { get(): Promise<{ siteName: string }> } };
	routes: { health: { output: { status: "ok" } } };
	services: { billing: { charge(cents: number): Promise<string> } };
}

declare const factory: GeneratedAppFactory<TypedApp, StandardSession>;
declare const harness: TestApp<typeof factory>;

const user = harness.actor({
	user: {
		id: "user-1",
		email: "user@example.test",
		name: "User",
		tenantId: "tenant-1",
	},
});

user.run(async ({ app, context }) => {
	const posts: { docs: Array<{ id: string }> } =
		await app.collections.posts.find();
	const settings: { siteName: string } = await app.globals.settings.get();
	const chargeId: string = await app.services.billing.charge(100);
	const routeStatus: "ok" = app.routes.health.output.status;
	const tenantId: string = context.session.user.tenantId;
	return { posts, settings, chargeId, routeStatus, tenantId };
});

harness.actor({
	// @ts-expect-error app-specific required user fields remain required
	user: { id: "user-1", email: "user@example.test", name: "User" },
});

type PluginSession = StandardSession & {
	session: StandardSession["session"] & { activeOrganizationId: string };
};
declare const pluginFactory: GeneratedAppFactory<TypedApp, PluginSession>;
declare const pluginHarness: TestApp<typeof pluginFactory>;

pluginHarness.actor({
	// @ts-expect-error plugin-specific required session fields require exact-session input
	user: {
		id: "user-1",
		email: "user@example.test",
		name: "User",
		tenantId: "tenant-1",
	},
});

pluginHarness.actor({
	session: {
		user: {
			id: "user-1",
			email: "user@example.test",
			name: "User",
			tenantId: "tenant-1",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		session: {
			id: "session-1",
			userId: "user-1",
			token: "token-1",
			expiresAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
			activeOrganizationId: "org-1",
		},
	},
});
