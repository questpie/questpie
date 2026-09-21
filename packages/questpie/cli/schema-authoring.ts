import { createHash } from "node:crypto";
import {
	lstat,
	link,
	mkdir,
	mkdtemp,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import type * as Compiler from "@questpie/compiler";

import { committedArtifactDirectories } from "./artifacts";

type Api = typeof Compiler;
type Report = Readonly<Record<string, unknown>>;

function options(args: readonly string[], allowed: readonly string[]) {
	const values = new Map<string, string[]>();
	for (let i = 0; i < args.length; i++) {
		const key = args[i]!;
		const value = args[++i];
		if (!allowed.includes(key) || !value || value.startsWith("--"))
			throw new TypeError("invalid schema command arguments");
		if (key !== "--rename" && values.has(key))
			throw new TypeError(`duplicate ${key}`);
		values.set(key, [...(values.get(key) ?? []), value]);
	}
	return values;
}
function required(values: Map<string, string[]>, key: string): string {
	const value = values.get(key)?.[0];
	if (!value) throw new TypeError(`${key} is required`);
	return value;
}
async function directories(root: string, kind: "migrations" | "seeds") {
	try {
		return await committedArtifactDirectories(root, kind);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}
async function migrations(api: Api, root: string) {
	const chain = await Promise.all(
		(await directories(root, "migrations")).map((path) =>
			api.loadCommittedMigration(path),
		),
	);
	if (chain.length) api.verifyCommittedMigrationChain(chain);
	return chain;
}
function schema(
	result: Compiler.CompileApplicationResult,
): Compiler.SchemaProjectionV1 {
	return JSON.parse(result.generatedFiles["schema-projection.json"]!);
}
async function compile(api: Api, root: string) {
	const scratch = await mkdtemp(join(root, ".questpie/authoring-build-"));
	try {
		return await api.compileApplication({
			applicationRoot: root,
			outputDirectory: join(scratch, "generated"),
		});
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
async function publish(
	root: string,
	destination: string,
	files: Readonly<Record<string, string>>,
) {
	try {
		await lstat(destination);
		throw new TypeError(
			"artifact destination already exists; refusing to replace history",
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const staging = await mkdtemp(join(root, ".questpie/authoring-artifact-"));
	try {
		for (const [name, bytes] of Object.entries(files))
			await writeFile(join(staging, name), bytes, { flag: "wx" });
		// The authoring lock serializes allocation; rename publishes complete bytes.
		// Existing nonempty artifact directories cannot be replaced by rename.
		await rename(staging, destination);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function plan(
	api: Api,
	root: string,
	args: readonly string[],
	connectionString?: string,
): Promise<Report> {
	const flags = options(args, ["--name", "--rename"]);
	const slug = required(flags, "--name");
	const renames = (flags.get("--rename") ?? []).map((value) => {
		const pieces = value.split("=");
		if (
			pieces.length !== 2 ||
			!pieces.every((item) => item.startsWith("collection:"))
		)
			throw new TypeError(
				"--rename requires collection or field identity=identity",
			);
		return {
			from: pieces[0] as Compiler.RenameIdentityV1,
			to: pieces[1] as Compiler.RenameIdentityV1,
		};
	});
	const chain = await migrations(api, root);
	const targetSchema = schema(await compile(api, root));
	const head = chain.at(-1);
	const planned = api.createMigrationPlan({
		targetSchema,
		slug,
		renames,
		...(head
			? { baseMigration: head.identity, baseSchema: head.targetSchema }
			: {}),
	});
	if (connectionString) {
		const base =
			planned.status === "planned"
				? planned.baseSchema
				: (head?.targetSchema ?? targetSchema);
		await api.inspectSchemaFingerprint({ connectionString, schema: base });
	}
	if (planned.status === "noChanges") return { status: "noChanges" };
	const bytes = api.canonicalArtifactBytes(planned.plan);
	const directory = join(root, ".questpie/plans");
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${planned.digest}.json`);
	const staging = await mkdtemp(join(directory, ".write-"));
	try {
		const stagedPlan = join(staging, "plan.json");
		await writeFile(stagedPlan, bytes, { flag: "wx" });
		try {
			await link(stagedPlan, path);
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "EEXIST" ||
				(await readFile(path, "utf8")) !== bytes
			)
				throw error;
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
	}

	return {
		status: "planned",
		path: relative(root, path),
		digest: planned.digest,
		classification: planned.plan.classification,
		plan: planned.plan,
	};
}
async function createMigration(
	api: Api,
	root: string,
	args: readonly string[],
): Promise<Report> {
	const flags = options(args, ["--plan", "--accept-destructive"]);
	const path = resolve(root, required(flags, "--plan"));
	const bytes = await readFile(path, "utf8");
	const plan = JSON.parse(bytes) as Compiler.MigrationPlanV1;
	const planDigest = createHash("sha256")
		.update("questpie-migration-plan-v1\0")
		.update(bytes)
		.digest("hex");
	if (
		bytes !== api.canonicalArtifactBytes(plan) ||
		basename(path) !== `${planDigest}.json`
	)
		throw new TypeError(
			"Migration Plan bytes or digest filename changed; create a fresh plan",
		);
	const chain = await migrations(api, root);
	const currentSchema = schema(await compile(api, root));
	const head = chain.at(-1);
	const replanned = api.createMigrationPlan({
		targetSchema: currentSchema,
		slug: plan.slug,
		renames: plan.renames,
		...(head
			? { baseMigration: head.identity, baseSchema: head.targetSchema }
			: {}),
	});
	if (replanned.status !== "planned" || replanned.digest !== planDigest)
		throw new api.CompilerDiagnosticError(
			"QP-SCHEMA-022",
			"stalePlan",
			"Definitions or migration history changed after planning",
		);
	const migration = api.createCommittedMigration({
		plan,
		baseSchema: replanned.baseSchema,
		targetSchema: currentSchema,
		currentSchema,
		planDigest,
		localMigrations: chain,
		...(flags.has("--accept-destructive")
			? { acceptDestructive: required(flags, "--accept-destructive") }
			: {}),
	});
	const parent = join(root, "questpie/migrations");
	await mkdir(parent, { recursive: true });
	await publish(root, join(parent, migration.identity), { ...migration.files });
	return {
		status: "created",
		identity: migration.identity,
		path: relative(root, join(parent, migration.identity)),
		checksum: migration.checksum,
	};
}
async function createSeeds(
	api: Api,
	root: string,
	args: readonly string[],
): Promise<Report> {
	if (args.length) throw new TypeError("use seed create (all source Seeds)");
	const compiled = await compile(api, root);
	const existing = await Promise.all(
		(await directories(root, "seeds")).map((path) =>
			api.loadCommittedSeed(path),
		),
	);
	const byIdentity = new Map(existing.map((seed) => [seed.identity, seed]));
	const pending: Compiler.CommittedSeedV1[] = [];
	for (const seed of compiled.committedSeeds) {
		const name = seed.identity.slice("seed:".length);
		if (
			!/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/.test(name) ||
			name.length > 255
		)
			throw new TypeError("Seed identity must be a qualified resource name");
		const prior = byIdentity.get(seed.identity);
		if (prior && prior.checksum !== seed.checksum)
			throw new TypeError(
				`immutable Seed ${seed.identity} changed; create a new Seed identity`,
			);
		if (!prior) {
			pending.push(seed);
			byIdentity.set(seed.identity, seed);
		}
	}
	// Validate all conflicts and dependency closure before publishing any new Seed.
	const ordered = api.orderCommittedSeeds([...byIdentity.values()]);
	const wanted = new Set(pending.map((seed) => seed.identity));
	const parent = join(root, "questpie/seeds");
	await mkdir(parent, { recursive: true });
	for (const seed of ordered)
		if (wanted.has(seed.identity))
			await publish(root, join(parent, seed.identity.slice(5)), seed.files);
	return {
		status: pending.length ? "created" : "unchanged",
		seeds: pending.map((seed) => seed.identity),
	};
}

/** Project compiler-owned schema operations to reviewable, immutable local files. */
export async function authorSchema(
	api: Api,
	root: string,
	args: readonly string[],
	connectionString?: string,
): Promise<Report> {
	await mkdir(join(root, ".questpie"), { recursive: true });
	const lockPath = join(root, ".questpie/authoring.lock");
	let lock;
	try {
		lock = await open(lockPath, "wx");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new TypeError(
				"schema authoring is locked; wait for the other command, or remove .questpie/authoring.lock only after confirming its owner has stopped",
				{ cause: error },
			);
		throw error;
	}
	try {
		await lock.writeFile(`${process.pid}\n`);
		if (args[0] === "migration" && args[1] === "plan")
			return await plan(api, root, args.slice(2), connectionString);
		if (args[0] === "migration" && args[1] === "create")
			return await createMigration(api, root, args.slice(2));
		if (args[0] === "seed" && args[1] === "create")
			return await createSeeds(api, root, args.slice(2));
		throw new TypeError(
			"use migration plan --name <slug>, migration create --plan <path>, or seed create",
		);
	} finally {
		await lock.close();
		await rm(lockPath, { force: true });
	}
}
