import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	cloudInitCommand,
	cloudRollbackCommand,
	createCloudDeployPayload,
} from "../../src/cli/commands/cloud.js";

const tmpDirs: string[] = [];
const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();
// Env that would otherwise leak the CI runner's git context into the CLI's
// metadata probes — these fixtures assert the EMPTY-repo result, but a GitHub
// runner executes them inside the checkout (GITHUB_*/CI_* + git walk-up resolve
// the runner branch + repo URL). Cleared per-test, restored in afterEach.
const GIT_ENV_KEYS = [
	"GIT_DIR",
	"GITHUB_REPOSITORY",
	"GITHUB_REF_NAME",
	"GITHUB_SHA",
	"CI_REPO_CLONE_URL",
	"CI_REPO_URL",
	"CI_COMMIT_BRANCH",
	"CI_COMMIT_SHA",
] as const;
const savedGitEnv = new Map<string, string | undefined>();

async function createTempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "questpie-cloud-cli-"));
	tmpDirs.push(dir);
	await writeFile(join(dir, "Dockerfile"), "FROM oven/bun:1\n", "utf8");
	return dir;
}

describe("Questpie Cloud CLI", () => {
	beforeEach(() => {
		// Fail every git/CI probe closed so the temp project resolves to no repo
		// (branch -> "main" default, no repoUrl) deterministically on CI + locally.
		for (const key of GIT_ENV_KEYS) {
			savedGitEnv.set(key, process.env[key]);
			delete process.env[key];
		}
		process.env.GIT_DIR = "/questpie-cloud-cli-no-git";
	});

	afterEach(async () => {
		for (const [key, value] of savedGitEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		savedGitEnv.clear();
		globalThis.fetch = originalFetch;
		process.chdir(originalCwd);
		for (const dir of tmpDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("sends strict account-scoped init intent to Questpie Cloud", async () => {
		const rootDir = await createTempProject();
		process.chdir(rootDir);

		let requestBody: any;
		globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return Response.json({
				dryRun: true,
				project: { slug: "demo", name: "Demo" },
				environment: { slug: "production", kind: "production" },
				services: [],
				toml: 'account = "acme"\nproject = "demo"\n',
			});
		};

		await cloudInitCommand({
			config: "questpie.cloud.toml",
			cloudUrl: "https://cloud.example.test",
			token: "test-token",
			account: "acme",
			project: "demo",
			name: "Demo",
			environment: "production",
			dockerfile: "Dockerfile",
			context: ".",
			service: "web",
			port: 3000,
			readiness: "/api/health",
			dryRun: true,
			yes: true,
		});

		expect(requestBody).toEqual({
			account: { slug: "acme" },
			project: {
				slug: "demo",
				name: "Demo",
				defaultBranch: "main",
			},
			environment: {
				slug: "production",
				kind: "production",
				region: "eu-main",
			},
			build: {
				strategy: "dockerfile",
				dockerfilePath: "Dockerfile",
				contextPath: ".",
			},
			services: [
				{
					name: "web",
					processType: "web",
					containerPort: 3000,
					readinessMode: "http",
					readinessPath: "/api/health",
				},
			],
			resources: {},
			dryRun: true,
		});
	});

	it("builds deploy payload from account-scoped thin config", async () => {
		const rootDir = await createTempProject();
		const configPath = join(rootDir, "questpie.cloud.toml");
		await writeFile(
			configPath,
			`
account = "acme"
project = "demo"

[environment]
slug = "production"
kind = "production"

[build]
dockerfilePath = "Dockerfile"
contextPath = "."

[[services]]
name = "web"
processType = "web"
containerPort = 3000
readinessMode = "http"
readinessPath = "/api/health"

[resources.database]
enabled = true

[resources.email]
enabled = true
fromLocalPart = "hello"
`,
			"utf8",
		);

		const payload = await createCloudDeployPayload({
			config: configPath,
			repoUrl: "https://github.com/questpie/demo.git",
			repoPath: rootDir,
			branch: "main",
			commit: "0123456789abcdef",
			yes: true,
		});

		expect(payload.account).toEqual({ slug: "acme" });
		expect(payload.project).toEqual({ slug: "demo" });
		expect(payload.environment).toEqual({
			slug: "production",
			kind: "production",
			region: "eu-main",
		});
		expect(payload.resources).toEqual({
			database: { enabled: true },
			email: { enabled: true, fromLocalPart: "hello" },
		});
		expect(payload.services).toEqual([
			{
				name: "web",
				processType: "web",
				imageTag: "0123456789ab",
				containerPort: 3000,
				replicas: 1,
				readinessMode: "http",
				readinessPath: "/api/health",
			},
		]);
		expect(payload).not.toHaveProperty("registry");
		expect(payload).not.toHaveProperty("namespace");
		expect(payload.trigger).toBe("cli");
	});

	it("submits rollback and follows the rollback deployment id", async () => {
		const calls: Array<{ path: string; body: any }> = [];
		globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
			const endpoint = new URL(String(url));
			const body = JSON.parse(String(init?.body));
			calls.push({ path: endpoint.pathname, body });

			if (endpoint.pathname.endsWith("/cloud/deployments/rollback")) {
				return Response.json({
					ok: true,
					deploymentId: "rollback-deployment",
					previousDeploymentId: "previous-deployment",
					buildId: "rollback-build",
					statusUrl: "/api/cloud/deployments/status?id=rollback-deployment",
				});
			}

			return Response.json({
				ok: true,
				deployment: {
					id: "rollback-deployment",
					status: "deployed",
					dryRun: false,
				},
				environment: {
					appUrl: "https://demo.questpie.app",
				},
				events: [],
				terminal: true,
			});
		};

		await cloudRollbackCommand("target-deployment", {
			cloudUrl: "https://cloud.example.test",
			token: "test-token",
			follow: true,
			pollIntervalSeconds: 1,
			timeoutSeconds: 10,
		});

		expect(calls).toEqual([
			{
				path: "/api/cloud/deployments/rollback",
				body: { deploymentId: "target-deployment" },
			},
			{
				path: "/api/cloud/deployments/status",
				body: { deploymentId: "rollback-deployment" },
			},
		]);
	});
});
