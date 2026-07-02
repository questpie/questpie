import { describe, expect, it } from "bun:test";

import { createFetchHandler, starterModule } from "questpie";
import {
	evaluateRouteAccess,
	route,
	type HttpMethod,
	type RouteDefinition,
} from "questpie/services";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { sessionOnly } from "../lib/route-access";
import chatRoute from "../routes/chat";
import eventsRoute from "../routes/events";
import intakeRoute from "../routes/intake";
import runStreamRoute from "../routes/run-stream";
import runStatusRoute from "../routes/runs/[runId]";
import runArtifactsRoute from "../routes/runs/[runId]/artifacts";
import runArtifactContentRoute from "../routes/runs/[runId]/artifacts/[artifactId]/content";
import workspaceContentRoute from "../routes/workspace-inspection/content";
import workspaceDiffRoute from "../routes/workspace-inspection/diff";
import workspaceListRoute from "../routes/workspace-inspection/list";
import workspaceReadRoute from "../routes/workspace-inspection/read";

type Policy = "sessionOnly";

type RouteAccessCase = {
	file: string;
	route: RouteDefinition;
	methods: readonly HttpMethod[];
	mode: "json" | "raw";
	policy: Policy;
	reason: string;
	coverage: string;
};

const routeAccessCases = [
	{
		file: "routes/intake.ts",
		route: intakeRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "creates tasks, activity, and workflow runs",
		coverage: "autopilot-route-access.test.ts, intake-route.test.ts",
	},
	{
		file: "routes/chat.ts",
		route: chatRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "creates chat sessions, messages, and run links",
		coverage: "autopilot-route-access.test.ts, chat-realtime-workflow.test.ts",
	},
	{
		file: "routes/events.ts",
		route: eventsRoute,
		methods: ["GET"],
		mode: "raw",
		policy: "sessionOnly",
		reason: "streams activity and active run data",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/run-stream.ts",
		route: runStreamRoute,
		methods: ["GET"],
		mode: "raw",
		policy: "sessionOnly",
		reason: "streams run snapshots",
		coverage: "autopilot-route-access.test.ts, chat-realtime-workflow.test.ts",
	},
	{
		file: "routes/runs/[runId].ts",
		route: runStatusRoute,
		methods: ["GET"],
		mode: "raw",
		policy: "sessionOnly",
		reason: "returns run status and linked task/project identifiers",
		coverage: "autopilot-route-access.test.ts, chat-realtime-workflow.test.ts",
	},
	{
		file: "routes/runs/[runId]/artifacts.ts",
		route: runArtifactsRoute,
		methods: ["GET", "POST"],
		mode: "raw",
		policy: "sessionOnly",
		reason: "lists and creates run artifacts",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/runs/[runId]/artifacts/[artifactId]/content.ts",
		route: runArtifactContentRoute,
		methods: ["GET"],
		mode: "raw",
		policy: "sessionOnly",
		reason: "returns artifact content",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/workspace-inspection/list.ts",
		route: workspaceListRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "reads workspace directory listings",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/workspace-inspection/content.ts",
		route: workspaceContentRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "reads workspace file content",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/workspace-inspection/diff.ts",
		route: workspaceDiffRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "reads workspace diffs and git metadata",
		coverage: "autopilot-route-access.test.ts",
	},
	{
		file: "routes/workspace-inspection/read.ts",
		route: workspaceReadRoute,
		methods: ["POST"],
		mode: "json",
		policy: "sessionOnly",
		reason: "reads workspace files",
		coverage: "autopilot-route-access.test.ts",
	},
] as const satisfies readonly RouteAccessCase[];

function routeMethods(route: RouteDefinition): HttpMethod[] {
	return Array.isArray(route.method) ? route.method : [route.method];
}

describe("Autopilot custom route access policies", () => {
	it("documents every custom route with an explicit policy", () => {
		for (const testCase of routeAccessCases) {
			expect(testCase.route.access, testCase.file).toBe(sessionOnly);
			expect(routeMethods(testCase.route), testCase.file).toEqual(
				testCase.methods,
			);
			expect(testCase.route.mode, testCase.file).toBe(testCase.mode);
			expect(testCase.policy, testCase.file).toBe("sessionOnly");
			expect(testCase.reason, testCase.file).toBeTruthy();
			expect(testCase.coverage, testCase.file).toContain(
				"autopilot-route-access.test.ts",
			);
		}
	});

	it("requires an authenticated principal and ignores local-dev headers", async () => {
		const localDevRequest = new Request("http://localhost/api/runs/run-1", {
			headers: { "x-local-dev": "true" },
		});
		const authenticatedPrincipal = {
			user: {
				id: "operator-1",
				email: "operator@example.test",
				role: "user",
			},
			session: {
				id: "session-1",
				userId: "operator-1",
				expiresAt: new Date(Date.now() + 60_000),
			},
		};

		for (const testCase of routeAccessCases) {
			expect(
				await evaluateRouteAccess(testCase.route.access, { session: null }),
				testCase.file,
			).toBe(false);
			expect(
				await evaluateRouteAccess(testCase.route.access, {
					session: { session: { id: "session-1" } },
				}),
				testCase.file,
			).toBe(false);
			expect(
				await evaluateRouteAccess(testCase.route.access, {
					session: { user: { id: "" } },
				}),
				testCase.file,
			).toBe(false);
			expect(
				await evaluateRouteAccess(testCase.route.access, {
					request: localDevRequest,
					session: null,
				}),
				testCase.file,
			).toBe(false);
			expect(
				await evaluateRouteAccess(testCase.route.access, {
					session: authenticatedPrincipal,
				}),
				testCase.file,
			).toBe(true);
		}
	});

	it("uses the Better Auth session resolved by the HTTP adapter", async () => {
		let setup: { app: MockApp; cleanup: () => Promise<void> } | undefined;
		try {
			const probeRoute = route()
				.get()
				.access(sessionOnly)
				.handler(async ({ session }) =>
					Response.json({ userId: session?.user.id }),
				);

			setup = await buildMockApp(
				{
					modules: [starterModule],
					auth: {
						emailAndPassword: {
							enabled: true,
							requireEmailVerification: false,
						},
					},
					routes: {
						authProbe: probeRoute,
					},
				},
				{
					secret: "test-auth-secret-with-more-than-32-chars",
				},
			);
			await runTestDbMigrations(setup.app);

			const signUpResponse = await setup.app.auth.api.signUpEmail({
				body: {
					email: "agent@example.test",
					password: "password123",
					name: "Agent User",
				},
				asResponse: true,
			});
			expect(signUpResponse.status).toBe(200);
			const signUpBody = await signUpResponse.json();

			const setCookieHeader = signUpResponse.headers.get("set-cookie");
			expect(setCookieHeader).toContain("better-auth.session_token=");
			const sessionCookie = setCookieHeader?.split(";")[0];
			expect(sessionCookie).toBeTruthy();

			const handler = createFetchHandler(setup.app, {
				basePath: "/api",
			});

			const authenticatedResponse = await handler(
				new Request("http://localhost/api/auth-probe", {
					method: "GET",
					headers: { cookie: sessionCookie! },
				}),
			);
			expect(authenticatedResponse?.status).toBe(200);
			const body = await authenticatedResponse?.json();
			expect(body.userId).toBe(signUpBody.user.id);

			const unauthenticatedResponse = await handler(
				new Request("http://localhost/api/auth-probe", { method: "GET" }),
			);
			expect(unauthenticatedResponse?.status).toBe(403);
		} finally {
			await setup?.cleanup();
		}
	});
});
