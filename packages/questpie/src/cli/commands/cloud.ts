import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

import { resolveCliPath } from "../utils.js";

const execFile = promisify(execFileCallback);

type AnyRecord = Record<string, unknown>;

export type CloudDeployOptions = {
	config: string;
	cloudUrl?: string;
	endpoint?: string;
	imageTag?: string;
	image?: string;
	imageDigest?: string;
	dryRun?: boolean;
	token?: string;
	printPayload?: boolean;
	noRequest?: boolean;
	repoUrl?: string;
	repoPath?: string;
	branch?: string;
	commit?: string;
};

type LoadedCloudConfig = {
	path: string;
	format: "toml" | "json";
	data: AnyRecord;
};

type GitMetadata = {
	repoUrl?: string;
	repoPath?: string;
	branch?: string;
	commit?: string;
	dirty?: boolean;
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

function isRecord(value: unknown): value is AnyRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickRecord(value: unknown): AnyRecord {
	return isRecord(value) ? value : {};
}

function records(value: unknown): AnyRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown) {
	return typeof value === "boolean" ? value : undefined;
}

function definedRecord(value: AnyRecord): AnyRecord {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item !== undefined),
	);
}

function shortSha(value: string | undefined) {
	return value ? value.slice(0, 12) : undefined;
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

function inferConfigFormat(configPath: string): "toml" | "json" {
	const extension = extname(configPath).toLowerCase();
	return extension === ".json" ? "json" : "toml";
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
		throw new Error(`${configPath} must contain an object`);
	}

	return { path: configPath, format, data };
}

async function git(args: string[], cwd = process.cwd()) {
	try {
		const result = await execFile("git", args, { cwd });
		return String(result.stdout).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function readGitMetadata(options: CloudDeployOptions): Promise<GitMetadata> {
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
	const porcelain = process.env.CI ? undefined : await git(["status", "--porcelain"]);

	return definedRecord({
		repoUrl: normalizeGitRepoUrl(repoUrl),
		repoPath: options.repoPath ?? (process.env.CI ? undefined : process.cwd()),
		branch,
		commit,
		dirty: porcelain === undefined ? false : porcelain.length > 0,
	}) as GitMetadata;
}

function projectPayload(config: AnyRecord) {
	const project = pickRecord(config.project);
	return definedRecord({
		slug: asString(config.project) ?? asString(project.slug),
		name: asString(project.name),
		clientSlug: asString(config.client) ?? asString(project.clientSlug),
		clientName: asString(project.clientName),
	});
}

function environmentPayload(config: AnyRecord) {
	const environment = pickRecord(config.environment);
	return definedRecord({
		slug: asString(environment.slug),
		name: asString(environment.name),
		kind: asString(environment.kind),
		region: asString(environment.region),
		namespace: asString(environment.namespace),
		appUrl: asString(environment.appUrl),
	});
}

function buildPayload(
	config: AnyRecord,
	options: CloudDeployOptions,
	imageTag: string,
) {
	const build = pickRecord(config.build);
	const mode =
		asString(build.mode) ??
		(options.imageTag || asString(build.imageTag) ? "prebuilt_image" : "remote_build");
	return definedRecord({
		mode,
		command: asString(build.command),
		dockerfilePath: asString(build.dockerfilePath) ?? "Dockerfile",
		image: options.image ?? asString(build.image),
		imageTag,
		imageDigest: options.imageDigest ?? asString(build.imageDigest),
	});
}

function servicesPayload(config: AnyRecord, imageTag: string) {
	return records(config.services).map((service) =>
		definedRecord({
			name: asString(service.name),
			processType: asString(service.processType),
			image: asString(service.image),
			imageTag: asString(service.imageTag) ?? imageTag,
			containerPort: asNumber(service.containerPort),
			replicas: asNumber(service.replicas),
			command: asString(service.command),
			readinessMode: asString(service.readinessMode),
			readinessPath: asString(service.readinessPath),
			resources: isRecord(service.resources) ? service.resources : undefined,
		}),
	);
}

function releaseJobsPayload(config: AnyRecord) {
	return records(config.releaseJobs).map((job) =>
		definedRecord({
			name: asString(job.name),
			service: asString(job.service),
			image: asString(job.image),
			imageTag: asString(job.imageTag),
			command: asString(job.command),
			runPolicy: asString(job.runPolicy),
			runId: asString(job.runId),
			backoffLimit: asNumber(job.backoffLimit),
			ttlSecondsAfterFinished: asNumber(job.ttlSecondsAfterFinished),
			resources: isRecord(job.resources) ? job.resources : undefined,
		}),
	);
}

function domainsPayload(config: AnyRecord) {
	return records(config.domains).map((domain) =>
		definedRecord({
			hostname: asString(domain.hostname),
			kind: asString(domain.kind),
			provider: asString(domain.provider),
			service: asString(domain.service),
			isPrimary: asBoolean(domain.isPrimary) ?? asBoolean(domain.primary),
			redirectMode: asString(domain.redirectMode),
		}),
	);
}

function postgresPayload(config: AnyRecord) {
	const postgres = pickRecord(config.postgres);
	return definedRecord({
		mode: asString(postgres.mode),
		clusterName: asString(postgres.clusterName),
		databaseName: asString(postgres.databaseName),
		username: asString(postgres.username),
		connectionEnvKey: asString(postgres.connectionEnvKey),
		passwordEnvKey: asString(postgres.passwordEnvKey),
	});
}

function storagePayload(config: AnyRecord) {
	const storage = pickRecord(config.storage);
	return definedRecord({
		provider: asString(storage.provider),
		bucketName: asString(storage.bucketName),
		prefix: asString(storage.prefix),
		endpoint: asString(storage.endpoint),
		region: asString(storage.region),
		publicBaseUrl: asString(storage.publicBaseUrl),
	});
}

export async function createCloudDeployPayload(
	options: CloudDeployOptions,
): Promise<DeployPayload> {
	const loaded = await loadCloudConfig(options.config);
	const gitMetadata = await readGitMetadata(options);
	const imageTag =
		options.imageTag ??
		process.env.QUESTPIE_CLOUD_IMAGE_TAG ??
		shortSha(gitMetadata.commit);

	if (!imageTag) {
		throw new Error("--image-tag, QUESTPIE_CLOUD_IMAGE_TAG, or git commit is required");
	}

	return definedRecord({
		name: asString(loaded.data.name),
		dryRun: Boolean(options.dryRun),
		project: projectPayload(loaded.data),
		environment: environmentPayload(loaded.data),
		git: gitMetadata,
		build: buildPayload(loaded.data, options, imageTag),
		services: servicesPayload(loaded.data, imageTag),
		releaseJobs: releaseJobsPayload(loaded.data),
		domains: domainsPayload(loaded.data),
		postgres: postgresPayload(loaded.data),
		storage: storagePayload(loaded.data),
		config: {
			path: loaded.path,
			format: loaded.format,
			data: loaded.data,
		},
	}) as DeployPayload;
}

function cloudEndpoint(cloudUrl: string, endpoint: string) {
	const base = cloudUrl.endsWith("/") ? cloudUrl : `${cloudUrl}/`;
	return new URL(endpoint.replace(/^\//, ""), base);
}

function printDeployResult(result: AnyRecord, imageTag: string) {
	console.log("Deployment accepted");
	console.log(`  Deployment: ${String(result.deploymentId ?? "unknown")}`);
	console.log(`  Project:    ${String(result.projectId ?? "unknown")}`);
	console.log(`  Image tag:  ${imageTag}`);
	console.log(`  Status:     ${String(result.status ?? "unknown")}`);

	const hostnames = Array.isArray(result.hostnames) ? result.hostnames : [];
	if (hostnames.length > 0) {
		console.log(`  Hostnames:  ${hostnames.map(String).join(", ")}`);
	}

	const domains = Array.isArray(result.domains) ? result.domains.filter(isRecord) : [];
	for (const domain of domains) {
		const hostname = String(domain.hostname ?? "unknown");
		const status = String(domain.status ?? "unknown");
		const target = asString(domain.targetHostname);
		console.log(`  Domain:     ${hostname} (${status})${target ? ` -> ${target}` : ""}`);
		const verification = pickRecord(domain.verification);
		const name = asString(verification.name);
		const value = asString(verification.value);
		const type = asString(verification.type);
		if (name || value) {
			console.log(
				`              verification ${type ?? "record"} ${name ?? ""} ${value ?? ""}`.trimEnd(),
			);
		}
	}
}

export async function cloudDeployCommand(options: CloudDeployOptions) {
	const payload = await createCloudDeployPayload(options);
	const imageTag = String(payload.build.imageTag);

	if (options.printPayload) {
		console.log(JSON.stringify(payload, null, 2));
	}

	if (options.noRequest) return;

	const cloudUrl =
		options.cloudUrl ??
		asString(payload.config.data.cloudUrl) ??
		process.env.QUESTPIE_CLOUD_URL;
	if (!cloudUrl) {
		throw new Error("Cloud URL is required. Set cloudUrl in config or QUESTPIE_CLOUD_URL.");
	}

	const token = options.token ?? process.env.QUESTPIE_CLOUD_TOKEN;
	if (!token) {
		throw new Error("QUESTPIE_CLOUD_TOKEN is required");
	}

	const response = await fetch(
		cloudEndpoint(cloudUrl, options.endpoint ?? "/api/cloud/deploy"),
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"x-api-key": token,
				"content-type": "application/json",
			},
			body: JSON.stringify(payload),
		},
	);

	const body = await response.text();
	if (!response.ok) {
		throw new Error(`Questpie Cloud deploy failed with HTTP ${response.status}: ${body}`);
	}

	const result = JSON.parse(body) as AnyRecord;
	printDeployResult(result, imageTag);
}
