import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename as pathBasename, dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { promisify } from "node:util";

import { resolveCliPath } from "../utils.js";

const execFile = promisify(execFileCallback);
const DEFAULT_CLOUD_URL = "https://cloud.questpie.com";
const DEFAULT_CONFIG_PATH = "questpie.cloud.toml";
const DEFAULT_ENVIRONMENT = "production";
const DEFAULT_READINESS_PATH = "/api/health";
const DEFAULT_PORT = 3000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_FOLLOW_TIMEOUT_SECONDS = 900;

type AnyRecord = Record<string, unknown>;

export type CloudLoginOptions = {
	cloudUrl?: string;
	token?: string;
	json?: boolean;
};

export type CloudWhoamiOptions = {
	cloudUrl?: string;
	token?: string;
	json?: boolean;
};

export type CloudInitOptions = {
	config: string;
	cloudUrl?: string;
	token?: string;
	account?: string;
	project?: string;
	name?: string;
	environment?: string;
	dockerfile?: string;
	context?: string;
	service?: string;
	port?: number;
	readiness?: string;
	envFile?: string;
	force?: boolean;
	yes?: boolean;
	dryRun?: boolean;
	json?: boolean;
	repoUrl?: string;
	branch?: string;
};

export type CloudEnvImportOptions = {
	config: string;
	cloudUrl?: string;
	token?: string;
	account?: string;
	service?: string;
	dryRun?: boolean;
	json?: boolean;
};

export type CloudDeployOptions = {
	config: string;
	cloudUrl?: string;
	endpoint?: string;
	imageTag?: string;
	image?: string;
	imageDigest?: string;
	dryRun?: boolean;
	token?: string;
	account?: string;
	json?: boolean;
	follow?: boolean;
	yes?: boolean;
	timeoutSeconds?: number;
	pollIntervalSeconds?: number;
	repoUrl?: string;
	repoPath?: string;
	branch?: string;
	commit?: string;
	printPayload?: boolean;
	noRequest?: boolean;
};

export type CloudRollbackOptions = {
	cloudUrl?: string;
	token?: string;
	json?: boolean;
	follow?: boolean;
	timeoutSeconds?: number;
	pollIntervalSeconds?: number;
};

type LoadedCloudConfig = {
	path: string;
	format: "toml" | "json";
	data: AnyRecord;
};

type CloudProfile = {
	cloudUrl?: string;
	token?: string;
	user?: {
		id: string;
		email?: string;
		name?: string | null;
	} | null;
	client?: {
		id: string;
		slug: string;
		name: string;
	} | null;
	apiKey?: {
		id?: string;
		name?: string | null;
		prefix?: string | null;
	} | null;
};

type GitMetadata = {
	repoUrl?: string;
	repoPath?: string;
	branch?: string;
	commit?: string;
	dirty?: boolean;
};

type ThinService = {
	name: string;
	processType: "web" | "worker" | "cron" | "job" | "release";
	port: number;
	readinessMode?: "http" | "tcp" | "none";
	readinessPath?: string;
	command?: string;
};

type ThinCloudConfig = {
	account?: string;
	project: string;
	environment: string;
	build: {
		dockerfile: string;
		context: string;
	};
	services: ThinService[];
	resources: AnyRecord;
};

type DeployPayload = AnyRecord & {
	git: GitMetadata;
	build: AnyRecord;
	config: {
		path: string;
		format: "toml" | "json";
		data: AnyRecord;
	};
};

export class CloudCliError extends Error {
	exitCode: number;
	silent: boolean;

	constructor(
		message: string,
		exitCode: number,
		options?: { silent?: boolean },
	) {
		super(message);
		this.name = "CloudCliError";
		this.exitCode = exitCode;
		this.silent = Boolean(options?.silent);
	}
}

export function getCloudErrorExitCode(error: unknown) {
	return error instanceof CloudCliError ? error.exitCode : 1;
}

export function isSilentCloudError(error: unknown) {
	return error instanceof CloudCliError && error.silent;
}

function localError(message: string) {
	return new CloudCliError(message, 1);
}

function authError(message: string) {
	return new CloudCliError(message, 4);
}

function cloudApiError(message: string) {
	return new CloudCliError(message, 2);
}

function isRecord(value: unknown): value is AnyRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): AnyRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function definedRecord(value: AnyRecord): AnyRecord {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item !== undefined),
	);
}

function slugify(value: string | undefined, fallback = "questpie-app") {
	const slug = value
		?.toLowerCase()
		.replace(/\.git$/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return slug || fallback;
}

function normalizePath(value: string) {
	return value.replaceAll("\\", "/");
}

function cloudProfilePath() {
	return join(homedir(), ".questpie", "cloud.json");
}

async function readCloudProfile(): Promise<CloudProfile> {
	try {
		const source = String(await readFile(cloudProfilePath(), "utf8"));
		const parsed = JSON.parse(source) as unknown;
		if (!isRecord(parsed)) return {};

		return definedRecord({
			cloudUrl: asString(parsed.cloudUrl),
			token: asString(parsed.token),
			user: isRecord(parsed.user) ? parsed.user : undefined,
			client: isRecord(parsed.client) ? parsed.client : undefined,
			apiKey: isRecord(parsed.apiKey) ? parsed.apiKey : undefined,
		}) as CloudProfile;
	} catch {
		return {};
	}
}

async function writeCloudProfile(profile: CloudProfile) {
	const profilePath = cloudProfilePath();
	await mkdir(dirname(profilePath), { recursive: true });
	const tempPath = `${profilePath}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(profile, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(tempPath, profilePath);
	await chmod(profilePath, 0o600);
}

function cloudEndpoint(cloudUrl: string, endpoint: string) {
	const base = cloudUrl.endsWith("/") ? cloudUrl : `${cloudUrl}/`;
	return new URL(endpoint.replace(/^\//, ""), base);
}

function sanitizeInternalTerms(message: string) {
	return message
		.replace(/GitOps\s+manifests?/gi, "deployment")
		.replace(/GitOps/gi, "deployment")
		.replace(/Flux/gi, "deployment")
		.replace(/Kubernetes/gi, "runtime")
		.replace(/namespace/gi, "environment")
		.replace(/registry/gi, "service")
		.replace(/provider/gi, "service")
		.replace(/manifest/gi, "deployment");
}

function errorMessageFromBody(status: number, body: string) {
	if (!body.trim()) return `Questpie Cloud returned HTTP ${status}`;

	try {
		const parsed = JSON.parse(body) as unknown;
		if (isRecord(parsed)) {
			const message =
				asString(parsed.message) ??
				asString(parsed.error) ??
				asString(parsed.statusText);
			if (message) return sanitizeInternalTerms(message);
		}
	} catch {
		// Fall through to sanitized text body.
	}

	return sanitizeInternalTerms(body.slice(0, 500));
}

async function requestCloud<T>(input: {
	cloudUrl: string;
	token: string;
	path: string;
	method?: "GET" | "POST";
	body?: unknown;
	authFailureExitCode?: number;
}) {
	const response = await fetch(cloudEndpoint(input.cloudUrl, input.path), {
		method: input.method ?? (input.body === undefined ? "GET" : "POST"),
		headers: {
			authorization: `Bearer ${input.token}`,
			"x-api-key": input.token,
			"content-type": "application/json",
		},
		body: input.body === undefined ? undefined : JSON.stringify(input.body),
	});
	const text = await response.text();

	if (!response.ok) {
		const message = errorMessageFromBody(response.status, text);
		if (response.status === 401 || response.status === 403) {
			throw new CloudCliError(message, input.authFailureExitCode ?? 4);
		}
		throw cloudApiError(message);
	}

	if (!text.trim()) return {} as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw cloudApiError("Questpie Cloud returned an invalid response");
	}
}

function printJson(value: unknown) {
	console.log(JSON.stringify(value, null, 2));
}

function profileCloudUrl(profile: CloudProfile, option?: string) {
	return (
		option ??
		process.env.QUESTPIE_CLOUD_URL ??
		profile.cloudUrl ??
		DEFAULT_CLOUD_URL
	);
}

function profileToken(profile: CloudProfile, option?: string) {
	return option ?? process.env.QUESTPIE_CLOUD_TOKEN ?? profile.token;
}

function profileAccountSlug(profile: CloudProfile, option?: string) {
	return (
		asString(option) ??
		asString(process.env.QUESTPIE_CLOUD_ACCOUNT) ??
		asString(profile.client?.slug)
	);
}

async function promptForToken() {
	if (!stdin.isTTY) {
		throw authError(
			"Questpie Cloud token is required. Pass --token or set QUESTPIE_CLOUD_TOKEN.",
		);
	}

	stdout.write("Questpie Cloud token: ");
	let source = "";
	for await (const chunk of stdin) {
		source += String(chunk);
		if (source.includes("\n")) break;
	}
	const token = source.split(/\r?\n/)[0]?.trim();
	if (!token) throw authError("Questpie Cloud token is required.");
	return token;
}

async function pathExists(path: string) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function readPackageJson(cwd = process.cwd()) {
	try {
		const source = String(await readFile(join(cwd, "package.json"), "utf8"));
		const parsed = JSON.parse(source) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

async function git(args: string[], cwd = process.cwd()) {
	try {
		const result = await execFile("git", args, { cwd });
		return String(result.stdout).trim() || undefined;
	} catch {
		return undefined;
	}
}

function normalizeGitRepoUrl(value: string | undefined) {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	const scpLike = /^git@([^:]+):(.+)$/.exec(trimmed);
	if (scpLike) {
		return `https://${scpLike[1]}/${scpLike[2]}`;
	}

	return trimmed;
}

async function readGitMetadata(
	options: Partial<CloudDeployOptions & CloudInitOptions>,
): Promise<GitMetadata> {
	const ciRepo =
		process.env.CI_REPO_CLONE_URL ??
		process.env.CI_REPO_URL ??
		(process.env.GITHUB_REPOSITORY
			? `https://github.com/${process.env.GITHUB_REPOSITORY}.git`
			: undefined);
	const repoUrl =
		options.repoUrl ??
		ciRepo ??
		(await git(["config", "--get", "remote.origin.url"]));
	const branch =
		options.branch ??
		process.env.CI_COMMIT_BRANCH ??
		process.env.GITHUB_REF_NAME ??
		(await git(["rev-parse", "--abbrev-ref", "HEAD"]));
	const commit =
		options.commit ??
		process.env.CI_COMMIT_SHA ??
		process.env.GITHUB_SHA ??
		(await git(["rev-parse", "HEAD"]));
	const porcelain = process.env.CI
		? undefined
		: await git(["status", "--porcelain"]);

	return definedRecord({
		repoUrl: normalizeGitRepoUrl(repoUrl),
		repoPath: options.repoPath ?? (process.env.CI ? undefined : process.cwd()),
		branch,
		commit,
		dirty: porcelain === undefined ? false : porcelain.length > 0,
	}) as GitMetadata;
}

function inferConfigFormat(configPath: string): "toml" | "json" {
	return configPath.toLowerCase().endsWith(".json") ? "json" : "toml";
}

async function loadCloudConfig(configPath: string): Promise<LoadedCloudConfig> {
	const resolvedPath = resolveCliPath(configPath);
	const format = inferConfigFormat(resolvedPath);
	const source = String(await readFile(resolvedPath, "utf8"));
	const data =
		format === "json"
			? JSON.parse(source)
			: (Bun.TOML.parse(source) as unknown);

	if (!isRecord(data)) {
		throw localError(`${configPath} must contain an object`);
	}

	return { path: configPath, format, data };
}

function normalizeThinConfig(loaded: LoadedCloudConfig): ThinCloudConfig {
	const data = loaded.data;
	const account =
		asString(data.account) ??
		(isRecord(data.account) ? asString(data.account.slug) : undefined);
	const project =
		asString(data.project) ??
		(isRecord(data.project) ? asString(data.project.slug) : undefined);
	const environment =
		asString(data.environment) ??
		(isRecord(data.environment)
			? asString(data.environment.slug)
			: undefined) ??
		DEFAULT_ENVIRONMENT;
	const build = isRecord(data.build) ? data.build : {};
	const dockerfile =
		asString(build.dockerfilePath) ??
		asString(build.dockerfile) ??
		"Dockerfile";
	const context = asString(build.contextPath) ?? asString(build.context) ?? ".";
	const services = records(data.services).map(
		(service): ThinService => ({
			name: slugify(asString(service.name), "web"),
			processType:
				asString(service.processType) === "worker" ||
				asString(service.processType) === "cron" ||
				asString(service.processType) === "job" ||
				asString(service.processType) === "release"
					? (asString(service.processType) as ThinService["processType"])
					: "web",
			port:
				asNumber(service.port) ??
				asNumber(service.containerPort) ??
				DEFAULT_PORT,
			readinessMode:
				asString(service.readinessMode) === "tcp" ||
				asString(service.readinessMode) === "none"
					? (asString(service.readinessMode) as ThinService["readinessMode"])
					: "http",
			readinessPath:
				asString(service.readinessPath) ?? asString(service.readiness),
			command: asString(service.command),
		}),
	);
	const resources = isRecord(data.resources) ? data.resources : {};

	if (!project) throw localError(`${loaded.path} is missing project`);
	if (services.length === 0) {
		throw localError(`${loaded.path} must contain at least one service`);
	}

	return {
		account: account ? slugify(account) : undefined,
		project: slugify(project),
		environment: slugify(environment, DEFAULT_ENVIRONMENT),
		build: { dockerfile, context },
		services,
		resources,
	};
}

async function inferDockerfile(options: CloudInitOptions) {
	if (options.dockerfile) return normalizePath(options.dockerfile);

	const candidates = [
		"Dockerfile",
		"apps/web/Dockerfile",
		"apps/app/Dockerfile",
		"apps/server/Dockerfile",
	];
	for (const candidate of candidates) {
		if (await pathExists(resolveCliPath(candidate))) return candidate;
	}

	return "Dockerfile";
}

function inferProjectName(pkg: AnyRecord, gitMetadata: GitMetadata) {
	return (
		asString(pkg.name) ??
		gitMetadata.repoUrl
			?.split(/[/:]/g)
			.at(-1)
			?.replace(/\.git$/g, "") ??
		pathBasename(process.cwd())
	);
}

type DotEnvParseResult = {
	vars: Record<string, string>;
	warnings: string[];
};

function unquoteEnvValue(value: string) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		const inner = trimmed.slice(1, -1);
		return trimmed.startsWith('"')
			? inner
					.replace(/\\n/g, "\n")
					.replace(/\\r/g, "\r")
					.replace(/\\t/g, "\t")
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, "\\")
			: inner;
	}
	return trimmed;
}

function parseDotEnv(source: string): DotEnvParseResult {
	const vars: Record<string, string> = {};
	const warnings: string[] = [];
	const lines = source.split(/\r?\n/);

	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return;

		const assignment = trimmed.startsWith("export ")
			? trimmed.slice("export ".length).trim()
			: trimmed;
		const equalsIndex = assignment.indexOf("=");
		if (equalsIndex === -1) {
			warnings.push(`Skipped line ${index + 1}: expected KEY=value.`);
			return;
		}

		const key = assignment.slice(0, equalsIndex).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			warnings.push(`Skipped line ${index + 1}: invalid env key.`);
			return;
		}

		if (Object.hasOwn(vars, key)) {
			warnings.push(`Duplicate ${key}; using the last value.`);
		}
		vars[key] = unquoteEnvValue(assignment.slice(equalsIndex + 1));
	});

	return { vars, warnings };
}

async function loadEnvFile(path: string) {
	const resolvedPath = resolveCliPath(path);
	if (!(await pathExists(resolvedPath))) {
		throw localError(`${path} does not exist`);
	}
	return parseDotEnv(String(await readFile(resolvedPath, "utf8")));
}

function isLikelySecret(key: string) {
	return /SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL|SMTP|S3|R2|AUTH/i.test(key);
}

function secretKeys(vars: Record<string, string>) {
	return Object.keys(vars).filter(isLikelySecret);
}

function deployJson(result: AnyRecord) {
	return {
		ok: result.ok === true,
		deploymentId: result.deploymentId ?? null,
		projectId: result.projectId ?? null,
		environmentId: result.environmentId ?? null,
		serviceIds: Array.isArray(result.serviceIds) ? result.serviceIds : [],
		hostnames: Array.isArray(result.hostnames) ? result.hostnames : [],
		status: result.status ?? null,
	};
}

function statusLabel(status: unknown, dryRun?: boolean) {
	const value = String(status ?? "unknown");
	if (dryRun && value === "rendered") return "validated";
	if (value === "rendering" || value === "rendered") return "preparing";
	if (value === "provisioning") return "deploying";
	if (value === "deployed") return "deployed";
	if (value === "failed") return "failed";
	if (value === "cancelled") return "cancelled";
	return value;
}

function printWhoami(result: AnyRecord) {
	const user = isRecord(result.user) ? result.user : null;
	const client = isRecord(result.client) ? result.client : null;
	console.log("Logged in to Questpie Cloud");
	if (user?.email) console.log(`User:      ${String(user.email)}`);
	if (client) {
		console.log(`Workspace: ${String(client.name)} (${String(client.slug)})`);
	} else {
		console.log("Workspace: not selected");
	}
	console.log(`Cloud URL: ${String(result.cloudUrl ?? DEFAULT_CLOUD_URL)}`);
}

function printInitResult(
	result: AnyRecord,
	configPath: string,
	envImport?: AnyRecord,
) {
	const project = isRecord(result.project) ? result.project : {};
	const environment = isRecord(result.environment) ? result.environment : {};
	console.log(
		result.dryRun ? "Initialization validated" : `Created ${configPath}`,
	);
	console.log(`Project:     ${String(project.slug ?? "unknown")}`);
	console.log(
		`Environment: ${String(environment.slug ?? DEFAULT_ENVIRONMENT)}`,
	);
	if (environment.appUrl)
		console.log(`URL:         ${String(environment.appUrl)}`);
	if (envImport) {
		const created = Array.isArray(envImport.created) ? envImport.created : [];
		const updated = Array.isArray(envImport.updated) ? envImport.updated : [];
		const skipped = Array.isArray(envImport.skipped) ? envImport.skipped : [];
		console.log(
			`Env import:  ${created.length} created, ${updated.length} updated, ${skipped.length} skipped`,
		);
	}
	console.log("Next:        questpie cloud deploy --follow");
}

function printEnvImportResult(result: AnyRecord, parserWarnings: string[]) {
	const created = Array.isArray(result.created)
		? result.created.map(String)
		: [];
	const updated = Array.isArray(result.updated)
		? result.updated.map(String)
		: [];
	const skipped = Array.isArray(result.skipped)
		? result.skipped.map(String)
		: [];
	const warnings = [
		...parserWarnings,
		...(Array.isArray(result.warnings) ? result.warnings.map(String) : []),
	];

	console.log(result.dryRun ? "Env import validated" : "Env vars imported");
	console.log(`Created: ${created.length}`);
	console.log(`Updated: ${updated.length}`);
	console.log(`Skipped: ${skipped.length}`);
	if (skipped.length > 0) console.log(`Skipped keys: ${skipped.join(", ")}`);
	for (const warning of warnings) console.log(`Warning: ${warning}`);
}

function printDeployResult(result: AnyRecord, dryRun?: boolean) {
	console.log(dryRun ? "Deploy dry run accepted" : "Deployment submitted");
	console.log(`Deployment: ${String(result.deploymentId ?? "unknown")}`);
	console.log(`Status:     ${statusLabel(result.status, dryRun)}`);

	const hostnames = Array.isArray(result.hostnames)
		? result.hostnames.map(String)
		: [];
	if (hostnames.length > 0) {
		console.log(`URL:        https://${hostnames[0]}`);
	}
}

function printRollbackResult(result: AnyRecord) {
	console.log("Rollback submitted");
	console.log(`Deployment: ${String(result.deploymentId ?? "unknown")}`);
	if (result.previousDeploymentId) {
		console.log(`Previous:   ${String(result.previousDeploymentId)}`);
	}
}

function printFollowEvents(status: AnyRecord, seenEventIds: Set<string>) {
	const events = Array.isArray(status.events)
		? status.events.filter(isRecord)
		: [];
	for (const event of events) {
		const id = asString(event.id);
		if (!id || seenEventIds.has(id)) continue;
		seenEventIds.add(id);
		const level = String(event.level ?? "info");
		const stage = String(event.stage ?? "deploy");
		const message = sanitizeInternalTerms(String(event.message ?? ""));
		console.log(`[${level}] ${stage}: ${message}`);
	}
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importEnvFileForConfig(input: {
	configPath: string;
	envFile: string;
	cloudUrl: string;
	token: string;
	account?: string;
	service?: string;
	dryRun?: boolean;
}) {
	const loaded = await loadCloudConfig(input.configPath);
	const config = normalizeThinConfig(loaded);
	const account = input.account ?? config.account;
	if (!account) {
		throw localError(
			`${input.configPath} is missing account. Run questpie cloud init again or pass --account.`,
		);
	}
	const parsed = await loadEnvFile(input.envFile);
	const result = await requestCloud<AnyRecord>({
		cloudUrl: input.cloudUrl,
		token: input.token,
		path: "/api/cloud/env-vars/import",
		body: {
			account: { slug: account },
			project: config.project,
			environment: config.environment,
			service: input.service,
			vars: parsed.vars,
			secretKeys: secretKeys(parsed.vars),
			dryRun: Boolean(input.dryRun),
		},
	});

	return { result, parserWarnings: parsed.warnings };
}

export async function cloudLoginCommand(options: CloudLoginOptions) {
	const profile = await readCloudProfile();
	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token =
		options.token ??
		process.env.QUESTPIE_CLOUD_TOKEN ??
		(await promptForToken());
	const whoami = await requestCloud<AnyRecord>({
		cloudUrl,
		token,
		path: "/api/cloud/whoami",
		authFailureExitCode: 4,
	});

	await writeCloudProfile({
		cloudUrl,
		token,
		user: isRecord(whoami.user) ? (whoami.user as CloudProfile["user"]) : null,
		client: isRecord(whoami.client)
			? (whoami.client as CloudProfile["client"])
			: null,
		apiKey: isRecord(whoami.apiKey)
			? (whoami.apiKey as CloudProfile["apiKey"])
			: null,
	});

	if (options.json) {
		printJson({
			ok: true,
			cloudUrl,
			user: whoami.user ?? null,
			client: whoami.client ?? null,
			apiKey: whoami.apiKey ?? null,
		});
		return;
	}

	printWhoami({ ...whoami, cloudUrl });
}

export async function cloudWhoamiCommand(options: CloudWhoamiOptions) {
	const profile = await readCloudProfile();
	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token = profileToken(profile, options.token);
	if (!token) {
		throw authError(
			"Questpie Cloud login is required. Run questpie cloud login.",
		);
	}

	const whoami = await requestCloud<AnyRecord>({
		cloudUrl,
		token,
		path: "/api/cloud/whoami",
		authFailureExitCode: 4,
	});

	if (options.json) {
		printJson(whoami);
		return;
	}

	printWhoami({ ...whoami, cloudUrl });
}

export async function cloudInitCommand(options: CloudInitOptions) {
	const profile = await readCloudProfile();
	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token = profileToken(profile, options.token);
	if (!token) {
		throw authError(
			"Questpie Cloud login is required. Run questpie cloud login.",
		);
	}
	const account = profileAccountSlug(profile, options.account);
	if (!account) {
		throw authError(
			"Questpie Cloud account is required. Pass --account, set QUESTPIE_CLOUD_ACCOUNT, or run questpie cloud login for a workspace.",
		);
	}

	const configPath = resolveCliPath(options.config ?? DEFAULT_CONFIG_PATH);
	if (
		!options.dryRun &&
		!options.force &&
		!options.yes &&
		(await pathExists(configPath))
	) {
		throw localError(
			`${options.config} already exists. Pass --yes or --force to overwrite it.`,
		);
	}

	const pkg = await readPackageJson();
	const gitMetadata = await readGitMetadata({
		repoUrl: options.repoUrl,
		branch: options.branch,
	});
	const inferredName = inferProjectName(pkg, gitMetadata);
	const projectSlug = slugify(options.project ?? inferredName);
	const environment = slugify(
		options.environment ?? DEFAULT_ENVIRONMENT,
		DEFAULT_ENVIRONMENT,
	);
	const dockerfile = normalizePath(await inferDockerfile(options));
	const context = normalizePath(options.context ?? ".");
	const serviceName = slugify(options.service ?? "web", "web");
	const port = options.port ?? DEFAULT_PORT;
	const readiness = options.readiness ?? DEFAULT_READINESS_PATH;
	if (!(await pathExists(resolveCliPath(dockerfile)))) {
		throw localError(`${dockerfile} does not exist`);
	}
	if (!(await pathExists(resolveCliPath(context)))) {
		throw localError(`${context} does not exist`);
	}

	const result = await requestCloud<AnyRecord>({
		cloudUrl,
		token,
		path: "/api/cloud/projects/init",
		body: {
			account: {
				slug: slugify(account),
			},
			project: {
				slug: projectSlug,
				name: options.name ?? inferredName,
				repoUrl: gitMetadata.repoUrl,
				defaultBranch: gitMetadata.branch ?? "main",
			},
			environment: {
				slug: environment,
				kind: environment === "production" ? "production" : "staging",
				region: "eu-main",
			},
			build: {
				strategy: "dockerfile",
				dockerfilePath: dockerfile,
				contextPath: context,
			},
			services: [
				{
					name: serviceName,
					processType: "web",
					containerPort: port,
					readinessMode: readiness ? "http" : "tcp",
					readinessPath: readiness,
				},
			],
			resources: {},
			dryRun: Boolean(options.dryRun),
		},
	});

	if (!options.dryRun) {
		await writeFile(configPath, String(result.toml ?? ""), "utf8");
	}

	let envImport: AnyRecord | undefined;
	let parserWarnings: string[] = [];
	if (options.envFile) {
		const imported = options.dryRun
			? await loadEnvFile(options.envFile).then((parsed) => ({
					result: {
						dryRun: true,
						created: Object.keys(parsed.vars),
						updated: [],
						skipped: [],
						warnings: parsed.warnings,
					},
					parserWarnings: parsed.warnings,
				}))
			: await importEnvFileForConfig({
					configPath,
					envFile: options.envFile,
					cloudUrl,
					token,
					account: slugify(account),
					dryRun: false,
				});
		envImport = imported.result;
		parserWarnings = imported.parserWarnings;
	}

	if (options.json) {
		printJson({
			ok: true,
			init: result,
			envImport,
			warnings: parserWarnings,
		});
		return;
	}

	if (options.dryRun && result.toml) {
		console.log(String(result.toml).trimEnd());
	}
	printInitResult(result, options.config, envImport);
}

export async function cloudEnvImportCommand(
	envFile: string,
	options: CloudEnvImportOptions,
) {
	const profile = await readCloudProfile();
	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token = profileToken(profile, options.token);
	if (!token) {
		throw authError(
			"Questpie Cloud login is required. Run questpie cloud login.",
		);
	}
	const account = profileAccountSlug(profile, options.account);

	const imported = await importEnvFileForConfig({
		configPath: options.config,
		envFile,
		cloudUrl,
		token,
		account,
		service: options.service,
		dryRun: Boolean(options.dryRun),
	});

	if (options.json) {
		printJson({
			ok: true,
			...imported.result,
			warnings: [
				...imported.parserWarnings,
				...(Array.isArray(imported.result.warnings)
					? imported.result.warnings
					: []),
			],
		});
		return;
	}

	printEnvImportResult(imported.result, imported.parserWarnings);
}

function shortSha(value: string | undefined) {
	return value ? value.slice(0, 12) : undefined;
}

function createDeployServices(config: ThinCloudConfig, imageTag?: string) {
	return config.services.map((service) =>
		definedRecord({
			name: service.name,
			processType: service.processType,
			imageTag,
			containerPort: service.port,
			replicas: 1,
			command: service.command,
			readinessMode: service.readinessMode,
			readinessPath: service.readinessPath,
		}),
	);
}

export async function createCloudDeployPayload(
	options: CloudDeployOptions,
): Promise<DeployPayload> {
	const loaded = await loadCloudConfig(options.config);
	const config = normalizeThinConfig(loaded);
	const account = profileAccountSlug({}, options.account) ?? config.account;
	const gitMetadata = await readGitMetadata(options);
	const imageTag =
		options.imageTag ??
		process.env.QUESTPIE_CLOUD_IMAGE_TAG ??
		shortSha(gitMetadata.commit);

	return definedRecord({
		dryRun: Boolean(options.dryRun),
		account: account ? { slug: slugify(account) } : undefined,
		project: {
			slug: config.project,
		},
		environment: {
			slug: config.environment,
			kind: config.environment === "production" ? "production" : "staging",
			region: "eu-main",
		},
		git: gitMetadata,
		build: definedRecord({
			mode: options.image ? "prebuilt_image" : "remote_build",
			dockerfilePath: config.build.dockerfile,
			image: options.image,
			imageTag,
			imageDigest: options.imageDigest,
		}),
		services: createDeployServices(config, imageTag),
		resources: config.resources,
		trigger: "cli",
		config: {
			path: loaded.path,
			format: loaded.format,
			data: loaded.data,
		},
	}) as DeployPayload;
}

async function followDeployment(input: {
	cloudUrl: string;
	token: string;
	deploymentId: string;
	json?: boolean;
	timeoutSeconds: number;
	pollIntervalSeconds: number;
}) {
	const seenEventIds = new Set<string>();
	const deadline = Date.now() + input.timeoutSeconds * 1000;
	let lastStatus: AnyRecord | null = null;

	while (Date.now() <= deadline) {
		lastStatus = await requestCloud<AnyRecord>({
			cloudUrl: input.cloudUrl,
			token: input.token,
			path: "/api/cloud/deployments/status",
			body: { deploymentId: input.deploymentId },
		});

		if (!input.json) printFollowEvents(lastStatus, seenEventIds);
		if (lastStatus.terminal) return lastStatus;
		await wait(input.pollIntervalSeconds * 1000);
	}

	const deployment = isRecord(lastStatus?.deployment)
		? lastStatus.deployment
		: {};
	throw new CloudCliError(
		`Timed out waiting for deployment ${input.deploymentId}. Last status: ${statusLabel(deployment.status, Boolean(deployment.dryRun))}`,
		5,
	);
}

export async function cloudDeployCommand(options: CloudDeployOptions) {
	const profile = await readCloudProfile();
	const payload = await createCloudDeployPayload(options);

	if (options.printPayload) {
		printJson(payload);
	}

	if (options.noRequest) return;
	if (payload.git.dirty && !options.yes && !process.env.CI) {
		throw localError(
			"Working tree has uncommitted changes. Pass --yes to deploy anyway.",
		);
	}

	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token = profileToken(profile, options.token);
	if (!token) {
		throw authError(
			"Questpie Cloud login is required. Run questpie cloud login.",
		);
	}

	const result = await requestCloud<AnyRecord>({
		cloudUrl,
		token,
		path: options.endpoint ?? "/api/cloud/deploy",
		body: payload,
	});

	const deploymentId = asString(result.deploymentId);
	let followStatus: AnyRecord | undefined;
	if (options.follow && deploymentId) {
		followStatus = await followDeployment({
			cloudUrl,
			token,
			deploymentId,
			json: Boolean(options.json),
			timeoutSeconds: options.timeoutSeconds ?? DEFAULT_FOLLOW_TIMEOUT_SECONDS,
			pollIntervalSeconds:
				options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
		});
	}

	const finalDeployment = isRecord(followStatus?.deployment)
		? followStatus.deployment
		: result;
	const finalStatus = String(finalDeployment.status ?? result.status ?? "");
	const failed = finalStatus === "failed" || finalStatus === "cancelled";

	if (options.json) {
		printJson({
			ok: !failed,
			deploy: deployJson(result),
			follow: followStatus,
		});
		if (failed) {
			throw new CloudCliError("Deployment failed", 3, { silent: true });
		}
		return;
	}

	printDeployResult(result, Boolean(options.dryRun));
	if (followStatus) {
		const deployment = isRecord(followStatus.deployment)
			? followStatus.deployment
			: {};
		console.log(
			`Final status: ${statusLabel(deployment.status, Boolean(deployment.dryRun))}`,
		);
		const environment = isRecord(followStatus.environment)
			? followStatus.environment
			: {};
		if (environment.appUrl)
			console.log(`URL:          ${String(environment.appUrl)}`);
	}

	if (failed) {
		throw new CloudCliError(
			`Deployment failed: ${sanitizeInternalTerms(String(finalDeployment.summary ?? finalStatus))}`,
			3,
		);
	}
}

export async function cloudRollbackCommand(
	deploymentId: string,
	options: CloudRollbackOptions,
) {
	const profile = await readCloudProfile();
	const cloudUrl = profileCloudUrl(profile, options.cloudUrl);
	const token = profileToken(profile, options.token);
	if (!token) {
		throw authError(
			"Questpie Cloud login is required. Run questpie cloud login.",
		);
	}

	const result = await requestCloud<AnyRecord>({
		cloudUrl,
		token,
		path: "/api/cloud/deployments/rollback",
		body: { deploymentId },
	});
	const rollbackDeploymentId = asString(result.deploymentId);
	let followStatus: AnyRecord | undefined;
	if (options.follow && rollbackDeploymentId) {
		followStatus = await followDeployment({
			cloudUrl,
			token,
			deploymentId: rollbackDeploymentId,
			json: Boolean(options.json),
			timeoutSeconds: options.timeoutSeconds ?? DEFAULT_FOLLOW_TIMEOUT_SECONDS,
			pollIntervalSeconds:
				options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
		});
	}

	const finalDeployment = isRecord(followStatus?.deployment)
		? followStatus.deployment
		: result;
	const finalStatus = String(finalDeployment.status ?? result.status ?? "");
	const failed = finalStatus === "failed" || finalStatus === "cancelled";

	if (options.json) {
		printJson({
			ok: !failed,
			rollback: {
				ok: result.ok === true,
				deploymentId: result.deploymentId ?? null,
				previousDeploymentId: result.previousDeploymentId ?? null,
				buildId: result.buildId ?? null,
				statusUrl: result.statusUrl ?? null,
			},
			follow: followStatus,
		});
		if (failed) {
			throw new CloudCliError("Rollback failed", 3, { silent: true });
		}
		return;
	}

	printRollbackResult(result);
	if (followStatus) {
		const deployment = isRecord(followStatus.deployment)
			? followStatus.deployment
			: {};
		console.log(`Final status: ${statusLabel(deployment.status)}`);
		const environment = isRecord(followStatus.environment)
			? followStatus.environment
			: {};
		if (environment.appUrl)
			console.log(`URL:          ${String(environment.appUrl)}`);
	}

	if (failed) {
		throw new CloudCliError(
			`Rollback failed: ${sanitizeInternalTerms(String(finalDeployment.summary ?? finalStatus))}`,
			3,
		);
	}
}
