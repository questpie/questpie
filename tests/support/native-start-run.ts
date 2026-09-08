import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

import { renderNativeQueryClients } from "./native-query-client";

const repository = resolve(import.meta.dir, "../..");
const selected = process.argv[2] ?? "all";
const scenarios = ["baseline", "faults", "credentials", "readiness"] as const;
if (!["build", "all", ...scenarios].includes(selected))
	throw new TypeError(
		"Expected build, all, baseline, faults, credentials or readiness",
	);
const temporary = await mkdtemp(join(tmpdir(), "questpie-native-start-"));
// Compiler scratch files also belong to this runner's cleanup boundary.
process.env.TMPDIR = temporary;
const application = join(temporary, "application");
const start = join(temporary, "start");
async function run(command: string[], timeout = 120_000) {
	const child = Bun.spawn(command, {
		cwd: start,
		env: { ...process.env, TMPDIR: temporary },
		stdout: "pipe",
		stderr: "pipe",
		timeout,
	});
	const [exit, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exit !== 0)
		throw new Error(`Native Start command failed (${exit}):\n${out}\n${err}`);
	return out;
}
try {
	await cp(join(repository, "fixtures/team-support-desk"), application, {
		recursive: true,
		filter: (path) => !["node_modules", ".questpie"].includes(basename(path)),
	});
	await symlink(
		join(repository, "fixtures/team-support-desk/node_modules"),
		join(application, "node_modules"),
		"dir",
	);
	await cp(join(import.meta.dir, "native-start"), start, {
		recursive: true,
		filter: (path) =>
			!["application", "node_modules", "dist", "routeTree.gen.ts"].includes(
				basename(path),
			),
	});
	// Keep Vite's writable .vite-temp directory local; dependency targets remain immutable.
	await mkdir(join(start, "node_modules"));
	for (const name of await readdir(join(repository, "node_modules"))) {
		if (name.startsWith(".")) continue;
		await symlink(
			join(repository, "node_modules", name),
			join(start, "node_modules", name),
			"dir",
		);
	}
	await writeFile(
		join(start, "package.json"),
		JSON.stringify({
			name: "questpie-native-start-consumer",
			private: true,
			type: "module",
			imports: {
				"#questpie/client": "./generated/client.ts",
				"#questpie/ordinary-client": "./ordinary/ordinary-client.ts",
			},
		}),
	);
	// This runner is an ordinary Bun process: the Bun test scanner never owns compilation.
	await compileApplication({
		applicationRoot: application,
		outputDirectory: join(start, "generated"),
	});
	// Current source-authored Queries are watchable. Exercise the ordinary browser
	// branch separately with the existing production-rendered compiler IR fixture.
	const ordinary = join(start, "ordinary");
	await mkdir(ordinary);
	await renderNativeQueryClients(ordinary);
	const ordinaryModule = await import(
		pathToFileURL(join(ordinary, "ordinary-client.ts")).href
	);
	const ordinaryScope = ordinaryModule
		.createClient({ baseUrl: "http://127.0.0.1" })
		.withContext({ companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" });
	if ("watch" in ordinaryScope.queries["tasks.summary"])
		throw new Error(
			"Ordinary compiler-IR browser control must not expose watch",
		);
	await run([process.execPath, join(start, "build.ts")]);
	await run([
		process.execPath,
		join(repository, "node_modules/typescript/bin/tsc"),
		"--noEmit",
	]);
	console.log(
		JSON.stringify({
			scenario: "native-start-build",
			compiled: true,
			typechecked: true,
		}),
	);
	for (const scenario of scenarios) {
		if (selected !== "all" && selected !== scenario) continue;
		const file =
			scenario === "baseline" ? "tracer.ts" : `tracer-${scenario}.ts`;
		console.log(
			(await run([process.execPath, join(start, file)], 180_000)).trim(),
		);
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
}
