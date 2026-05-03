import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveCliPath } from "../utils.js";

type JsonObject = Record<string, unknown>;

type CloudConfigFormat = "toml" | "yaml" | "json" | "none";

type CloudDeployStrategy = "adopt" | "render_only" | "gitops_commit";

type BuildMode = "local_image" | "remote_build" | "prebuilt_image";

type ProcessType = "web" | "worker" | "cron" | "job";

export interface CloudDeployOptions {
	cwd?: string;
	config?: string;
	cloudUrl?: string;
	token?: string;
	project?: string;
	client?: string;
	environment?: string;
	region?: string;
	namespace?: string;
	appUrl?: string;
	domain?: string[];
	registry?: string;
	image?: string;
	imageTag?: string;
	dockerfile?: string;
	dockerTarget?: string;
	buildCommand?: string;
	build?: boolean;
	push?: boolean;
	dryRun?: boolean;
	allowDirty?: boolean;
	printPayload?: boolean;
	strategy?: string;
	service?: string;
	port?: string;
}

type ServiceConfig = {
	name?: string;
	processType?: ProcessType;
	port?: number;
	containerPort?: number;
	replicas?: number;
	command?: string;
	image?: string;
	imageTag?: string;
};

type DomainConfig = {
	hostname: string;
	kind?: "internal" | "custom";
	provider?: "cloudflare" | "manual";
	service?: string;
	isPrimary?: boolean;
};

type LoadedConfig = {
	path?: string;
	format: CloudConfigFormat;
	data: JsonObject;
};

type GitInfo = {
	root: string;
	repoUrl?: string;
	branch?: string;
	commit?: string;
	dirty: boolean;
};

const CONFIG_FILES = [
	"questpie.cloud.toml",
	"questpie.cloud.yaml",
	"questpie.cloud.yml",
	"questpie.cloud.json",
] as const;

const VALID_STRATEGIES: CloudDeployStrategy[] = [
	"adopt",
	"render_only",
	"gitops_commit",
];
const YAML_LIST_KEYS = new Set(["services", "domains"]);

export async function cloudDeployCommand(
	options: CloudDeployOptions,
): Promise<void> {
	const cwd = resolve(options.cwd ?? process.cwd());
	const git = getGitInfo(cwd);
	const config = loadCloudConfig(git.root, options.config);
	const packageJson = loadPackageJson(git.root);
	const gitRepoName = git.repoUrl
		? basename(git.repoUrl.replace(/\/+$/g, ""))
		: basename(git.root);
	const projectSlug = slugify(
		options.project ??
			readString(config.data, "project.slug") ??
			readString(config.data, "project") ??
			readString(packageJson, "questpie.cloud.project") ??
			gitRepoName ??
			readString(packageJson, "name") ??
			"questpie-app",
	);
	const clientSlug = slugify(
		options.client ??
			readString(config.data, "project.clientSlug") ??
			readString(config.data, "client") ??
			"internal",
	);
	const environmentSlug = slugify(
		options.environment ??
			readString(config.data, "environment.slug") ??
			readString(config.data, "environment") ??
			"production",
	);
	const region =
		options.region ??
		readString(config.data, "environment.region") ??
		readString(config.data, "region") ??
		process.env.QUESTPIE_CLOUD_REGION ??
		"eu-main";
	const cloudUrl = trimTrailingSlash(
		options.cloudUrl ??
			readString(config.data, "cloudUrl") ??
			process.env.QUESTPIE_CLOUD_URL ??
			"http://localhost:3000",
	);
	const token =
		options.token ??
		readString(config.data, "token") ??
		process.env.QUESTPIE_CLOUD_TOKEN ??
		process.env.QUESTPIE_CLOUD_INTERNAL_TOKEN;
	const strategy = normalizeStrategy(
		options.strategy ?? readString(config.data, "strategy") ?? "gitops_commit",
	);
	const dockerfilePath =
		options.dockerfile ??
		readString(config.data, "build.dockerfilePath") ??
		readString(config.data, "dockerfile") ??
		"Dockerfile";
	const dockerfileAbs = resolve(git.root, dockerfilePath);
	const configuredServices = readServices(config.data);
	const domains = [
		...readDomains(config.data),
		...(options.domain ?? []).map((hostname) => ({
			hostname,
			kind: "custom" as const,
			provider: "cloudflare" as const,
		})),
	];
	const postgres = readObject(config.data, "postgres");
	const storage = readObject(config.data, "storage");
	const serviceName = slugify(
		options.service ?? configuredServices[0]?.name ?? "web",
	);
	const dockerTarget =
		options.dockerTarget ??
		readString(config.data, "build.dockerTarget") ??
		inferDockerTarget(dockerfileAbs, serviceName);
	const imageTag =
		options.imageTag ??
		readString(config.data, "build.imageTag") ??
		readString(config.data, "imageTag") ??
		git.commit?.slice(0, 12) ??
		"latest";
	const image =
		options.image ??
		readString(config.data, "build.image") ??
		readString(config.data, "image") ??
		buildDefaultImage(projectSlug, options.registry ?? readString(config.data, "registry"));
	const buildCommand =
		options.buildCommand ??
		readString(config.data, "build.command") ??
		readString(config.data, "buildCommand");
	const canBuild =
		options.build !== false &&
		(Boolean(buildCommand) || existsSync(dockerfileAbs));
	const shouldBuild = canBuild && !options.dryRun && !options.printPayload;
	const shouldPush =
		Boolean(options.push ?? readBoolean(config.data, "push")) &&
		!options.dryRun &&
		!options.printPayload;

	if (git.dirty && !options.allowDirty && !options.dryRun && !options.printPayload) {
		throw new Error(
			"Git working tree has uncommitted changes. Commit them or pass --allow-dirty.",
		);
	}

	if (shouldBuild) {
		runBuild({
			command: buildCommand,
			cwd: git.root,
			dockerfilePath,
			dockerTarget,
			image,
			imageTag,
		});
	} else if (!options.dryRun && !options.printPayload && options.build !== false) {
		console.warn("No Dockerfile or build command found; using prebuilt image metadata.");
	}

	if (shouldPush) {
		runStreaming("docker", ["push", `${image}:${imageTag}`], git.root);
	}

	const services =
		configuredServices.length > 0
			? configuredServices
			: [
					{
						name: serviceName,
						processType: "web" as const,
						containerPort: parsePort(options.port) ?? 3000,
						replicas: 1,
					},
				];

	const payload = {
		dryRun: Boolean(options.dryRun),
		strategy,
		project: {
			slug: projectSlug,
			name: readString(config.data, "project.name") ?? projectSlug,
			clientSlug,
			clientName: readString(config.data, "project.clientName"),
		},
		environment: {
			slug: environmentSlug,
			name: readString(config.data, "environment.name"),
			kind:
				readString(config.data, "environment.kind") ??
				(environmentSlug === "production" ? "production" : "staging"),
			region,
			namespace:
				options.namespace ?? readString(config.data, "environment.namespace"),
			appUrl: options.appUrl ?? readString(config.data, "environment.appUrl"),
		},
		git: {
			repoUrl: git.repoUrl,
			repoPath: git.root,
			branch: git.branch,
			commit: git.commit,
			dirty: git.dirty,
		},
		build: {
			mode: inferBuildMode(options.build, canBuild, buildCommand),
			command: buildCommand ?? formatDockerBuildCommand({
				dockerfilePath,
				dockerTarget,
				image,
				imageTag,
			}),
			dockerfilePath,
			image,
			imageTag,
		},
		services: services.map((service) => ({
			name: slugify(service.name ?? "web"),
			processType: service.processType ?? "web",
			image: service.image ?? serviceImage(image, service.name ?? "web"),
			imageTag: service.imageTag ?? imageTag,
			containerPort:
				service.containerPort ??
				service.port ??
				parsePort(options.port) ??
				3000,
			replicas: service.replicas ?? 1,
			command: service.command,
		})),
		domains: domains.length > 0 ? domains : undefined,
		postgres,
		storage,
		config: {
			path: config.path,
			format: config.format,
			data: config.data,
		},
	};

	if (options.printPayload) {
		console.log(JSON.stringify(payload, null, 2));
		return;
	}

	if (!token) {
		throw new Error(
			"Missing QUESTPIE Cloud API key. Set QUESTPIE_CLOUD_TOKEN.",
		);
	}

	const result = await postDeploy(cloudUrl, token, payload);
	console.log("Deployment accepted");
	console.log(`  Deployment: ${result.deploymentId ?? "unknown"}`);
	console.log(`  Project:    ${result.projectId ?? projectSlug}`);
	console.log(`  Image:      ${result.image ?? image}:${result.imageTag ?? imageTag}`);
	console.log(`  Status:     ${result.status ?? "queued"}`);
}

function getGitInfo(cwd: string): GitInfo {
	const root = git(["rev-parse", "--show-toplevel"], cwd) ?? cwd;

	return {
		root,
		repoUrl: git(["config", "--get", "remote.origin.url"], root) ?? undefined,
		branch: git(["branch", "--show-current"], root) ?? undefined,
		commit: git(["rev-parse", "HEAD"], root) ?? undefined,
		dirty: Boolean(git(["status", "--porcelain"], root)),
	};
}

function git(args: string[], cwd: string): string | null {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

	if (result.status !== 0) return null;
	const out = result.stdout.trim();
	return out.length > 0 ? out : null;
}

function loadPackageJson(root: string): JsonObject {
	const path = join(root, "package.json");
	if (!existsSync(path)) return {};

	return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function loadCloudConfig(root: string, explicitPath?: string): LoadedConfig {
	const configPath = explicitPath
		? resolveCliPath(explicitPath, root)
		: CONFIG_FILES.map((file) => join(root, file)).find((file) => existsSync(file));

	if (!configPath) return { format: "none", data: {} };

	const raw = readFileSync(configPath, "utf8");
	const ext = extname(configPath).toLowerCase();
	if (ext === ".json") {
		return { path: configPath, format: "json", data: JSON.parse(raw) };
	}
	if (ext === ".yaml" || ext === ".yml") {
		return { path: configPath, format: "yaml", data: parseSimpleYaml(raw) };
	}
	if (ext === ".toml") {
		return { path: configPath, format: "toml", data: parseSimpleToml(raw) };
	}

	throw new Error(`Unsupported cloud config format: ${configPath}`);
}

function parseSimpleToml(raw: string): JsonObject {
	const root: JsonObject = {};
	let current: JsonObject = root;

	for (const rawLine of raw.split(/\r?\n/)) {
		const line = stripComment(rawLine).trim();
		if (!line) continue;

		if (line.startsWith("[[") && line.endsWith("]]")) {
			const key = line.slice(2, -2).trim();
			const list = ensureArray(root, key);
			const item: JsonObject = {};
			list.push(item);
			current = item;
			continue;
		}

		if (line.startsWith("[") && line.endsWith("]")) {
			current = ensureObject(root, line.slice(1, -1).trim());
			continue;
		}

		const eq = line.indexOf("=");
		if (eq === -1) continue;

		current[line.slice(0, eq).trim()] = parseScalar(line.slice(eq + 1).trim());
	}

	return root;
}

function parseSimpleYaml(raw: string): JsonObject {
	const root: JsonObject = {};
	let currentKey: string | null = null;
	let currentObject: JsonObject | null = null;
	let currentListItem: JsonObject | null = null;

	for (const rawLine of raw.split(/\r?\n/)) {
		const withoutComment = stripComment(rawLine);
		if (!withoutComment.trim()) continue;

		const indent = withoutComment.search(/\S/);
		const line = withoutComment.trim();

		if (indent === 0 && line.endsWith(":")) {
			currentKey = line.slice(0, -1).trim();
			currentListItem = null;
			if (YAML_LIST_KEYS.has(currentKey)) {
				root[currentKey] = [];
				currentObject = null;
			} else {
				currentObject = {};
				root[currentKey] = currentObject;
			}
			continue;
		}

		if (line.startsWith("- ") && currentKey && YAML_LIST_KEYS.has(currentKey)) {
			const rest = line.slice(2).trim();
			if (rest.includes(":")) {
				const item: JsonObject = {};
				(root[currentKey] as JsonObject[]).push(item);
				currentListItem = item;
				assignYamlPair(item, rest);
			} else {
				(root[currentKey] as unknown[]).push(parseScalar(rest));
				currentListItem = null;
			}
			continue;
		}

		if (indent === 0) {
			assignYamlPair(root, line);
			currentKey = null;
			currentObject = null;
			currentListItem = null;
			continue;
		}

		if (currentListItem) {
			assignYamlPair(currentListItem, line);
		} else if (currentObject) {
			assignYamlPair(currentObject, line);
		}
	}

	return root;
}

function assignYamlPair(target: JsonObject, line: string) {
	const colon = line.indexOf(":");
	if (colon === -1) return;
	const key = line.slice(0, colon).trim();
	const rawValue = line.slice(colon + 1).trim();
	target[key] = parseScalar(rawValue);
}

function parseScalar(raw: string): unknown {
	const value = raw.trim();
	if (!value) return "";
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (value.startsWith("[") && value.endsWith("]")) {
		const inner = value.slice(1, -1).trim();
		return inner ? inner.split(",").map((part) => parseScalar(part.trim())) : [];
	}
	return value;
}

function stripComment(line: string) {
	let quote: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
			quote = quote === char ? null : quote ?? char;
		}
		if (char === "#" && !quote) return line.slice(0, i);
	}
	return line;
}

function ensureObject(root: JsonObject, path: string): JsonObject {
	const parts = path.split(".");
	let current = root;
	for (const part of parts) {
		const existing = current[part];
		if (!isObject(existing)) {
			current[part] = {};
		}
		current = current[part] as JsonObject;
	}
	return current;
}

function ensureArray(root: JsonObject, key: string): JsonObject[] {
	const existing = root[key];
	if (Array.isArray(existing)) return existing as JsonObject[];
	root[key] = [];
	return root[key] as JsonObject[];
}

function readServices(data: JsonObject): ServiceConfig[] {
	const services = data.services;
	if (!Array.isArray(services)) return [];

	return services
		.filter(isObject)
		.map((service) => ({
			name: readOwnString(service, "name"),
			processType: normalizeProcessType(readOwnString(service, "processType")),
			port: readOwnNumber(service, "port"),
			containerPort: readOwnNumber(service, "containerPort"),
			replicas: readOwnNumber(service, "replicas"),
			command: readOwnString(service, "command"),
			image: readOwnString(service, "image"),
			imageTag: readOwnString(service, "imageTag"),
		}));
}

function readDomains(data: JsonObject): DomainConfig[] {
	const domains = data.domains;
	if (!Array.isArray(domains)) return [];

	return domains
		.flatMap((domain) => {
			if (typeof domain === "string" && domain.trim()) {
				return [{ hostname: domain.trim() }];
			}
			if (!isObject(domain)) return [];

			const hostname = readOwnString(domain, "hostname") ?? readOwnString(domain, "host");
			if (!hostname) return [];

			return [
				{
					hostname,
					kind: normalizeDomainKind(readOwnString(domain, "kind")),
					provider: normalizeDomainProvider(readOwnString(domain, "provider")),
					service: readOwnString(domain, "service"),
					isPrimary:
						readOwnBoolean(domain, "isPrimary") ??
						readOwnBoolean(domain, "primary"),
				},
			];
		});
}

function readObject(data: JsonObject, path: string): JsonObject | undefined {
	const value = readPath(data, path);
	return isObject(value) ? value : undefined;
}

function readString(data: JsonObject, path: string): string | undefined {
	const value = readPath(data, path);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(data: JsonObject, path: string): boolean | undefined {
	const value = readPath(data, path);
	return typeof value === "boolean" ? value : undefined;
}

function readOwnString(data: JsonObject, key: string): string | undefined {
	const value = data[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOwnNumber(data: JsonObject, key: string): number | undefined {
	const value = data[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOwnBoolean(data: JsonObject, key: string): boolean | undefined {
	const value = data[key];
	return typeof value === "boolean" ? value : undefined;
}

function readPath(data: JsonObject, path: string): unknown {
	return path.split(".").reduce<unknown>((current, part) => {
		if (!isObject(current)) return undefined;
		return current[part];
	}, data);
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProcessType(value?: string): ProcessType | undefined {
	if (value === "web" || value === "worker" || value === "cron" || value === "job") {
		return value;
	}
	return undefined;
}

function normalizeDomainKind(value?: string): DomainConfig["kind"] | undefined {
	return value === "internal" || value === "custom" ? value : undefined;
}

function normalizeDomainProvider(value?: string): DomainConfig["provider"] | undefined {
	return value === "cloudflare" || value === "manual" ? value : undefined;
}

function normalizeStrategy(value: string): CloudDeployStrategy {
	if (VALID_STRATEGIES.includes(value as CloudDeployStrategy)) {
		return value as CloudDeployStrategy;
	}
	throw new Error(
		`Invalid deploy strategy "${value}". Expected one of: ${VALID_STRATEGIES.join(", ")}`,
	);
}

function inferBuildMode(
	buildOption: boolean | undefined,
	canBuild: boolean,
	buildCommand?: string,
): BuildMode {
	if (buildOption === false) return "prebuilt_image";
	if (canBuild || buildCommand) return "local_image";
	return "prebuilt_image";
}

function parsePort(value?: string): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid port: ${value}`);
	}
	return parsed;
}

function inferDockerTarget(dockerfilePath: string, serviceName: string): string | undefined {
	if (!existsSync(dockerfilePath)) return undefined;
	const dockerfile = readFileSync(dockerfilePath, "utf8");
	const targetPattern = new RegExp(`\\s+AS\\s+${escapeRegExp(serviceName)}\\b`, "i");
	if (targetPattern.test(dockerfile)) return serviceName;
	if (serviceName === "web" && /\s+AS\s+web\b/i.test(dockerfile)) return "web";
	return undefined;
}

function buildDefaultImage(projectSlug: string, registry?: string) {
	const normalizedRegistry = registry?.replace(/\/+$/g, "");
	return normalizedRegistry
		? `${normalizedRegistry}/${projectSlug}`
		: `questpie/${projectSlug}`;
}

function serviceImage(baseImage: string, serviceName: string) {
	return serviceName === "web" ? baseImage : `${baseImage}-${slugify(serviceName)}`;
}

function slugify(value: string) {
	const slug = value
		.replace(/\.git$/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "questpie-app";
}

function trimTrailingSlash(value: string) {
	return value.replace(/\/+$/g, "");
}

function runBuild(input: {
	command?: string;
	cwd: string;
	dockerfilePath: string;
	dockerTarget?: string;
	image: string;
	imageTag: string;
}) {
	if (input.command) {
		runStreaming("sh", ["-lc", input.command], input.cwd);
		return;
	}

	const args = [
		"build",
		"-f",
		input.dockerfilePath,
		"-t",
		`${input.image}:${input.imageTag}`,
		...(input.dockerTarget ? ["--target", input.dockerTarget] : []),
		".",
	];
	runStreaming("docker", args, input.cwd);
}

function formatDockerBuildCommand(input: {
	dockerfilePath: string;
	dockerTarget?: string;
	image: string;
	imageTag: string;
}) {
	return [
		"docker",
		"build",
		"-f",
		input.dockerfilePath,
		"-t",
		`${input.image}:${input.imageTag}`,
		...(input.dockerTarget ? ["--target", input.dockerTarget] : []),
		".",
	].join(" ");
}

function runStreaming(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed`);
	}
}

async function postDeploy(cloudUrl: string, token: string, payload: unknown) {
	const response = await fetch(`${cloudUrl}/api/cloud/deploy`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"x-api-key": token,
			"content-type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	const text = await response.text();
	const data = text ? JSON.parse(text) : {};

	if (!response.ok) {
		const message =
			typeof data?.error?.message === "string"
				? data.error.message
				: `QUESTPIE Cloud deploy failed with HTTP ${response.status}`;
		throw new Error(message);
	}

	return data as JsonObject;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
