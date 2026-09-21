import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");

export function nativeQueryDocsExample(source: string, path: string): string {
	const language = path.endsWith(".json")
		? "json"
		: path.endsWith(".tsx")
			? "tsx"
			: "ts";
	const opening = `\`\`\`${language} title="${path}"\n`;
	const start = source.indexOf(opening);
	if (start === -1) throw new Error(`Missing native tutorial example ${path}`);
	const end = source.indexOf("\n```", start + opening.length);
	if (end === -1)
		throw new Error(`Unterminated native tutorial example ${path}`);
	return `${source.slice(start + opening.length, end)}\n`;
}

export async function runNativeQueryDocs(
	command: string[],
	cwd: string,
	scratch: string,
) {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, TMPDIR: scratch },
		stdout: "pipe",
		stderr: "pipe",
		timeout: 60_000,
	});
	const [exit, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exit !== 0)
		throw new Error(
			`Native tutorial command failed (${exit}):\n${out}\n${err}`,
		);
	return out;
}

/** One source-authored public support example, installed and generated outside the workspace. */
export async function prepareNativeQueryDocs(
	temporary: string,
): Promise<string> {
	const guide = await readFile(
		resolve(repository, "apps/docs/content/docs/v4/react-query-basic.mdx"),
		"utf8",
	);
	const prerequisite = await readFile(
		join(repository, "apps/docs/content/docs/v4/data-and-queries.mdx"),
		"utf8",
	);
	const mutationGuide = await readFile(
		join(repository, "apps/docs/content/docs/v4/queries-and-mutations.mdx"),
		"utf8",
	);
	const packed = join(temporary, "packed");
	const consumer = join(temporary, "consumer");
	await mkdir(packed);
	await mkdir(consumer);
	await mkdir(join(consumer, "packages"));
	// The release build owns dist. Packing cannot rebuild or mutate shared output.
	await runNativeQueryDocs(
		[
			"bun",
			"pm",
			"pack",
			"--destination",
			packed,
			"--ignore-scripts",
			"--quiet",
		],
		join(repository, "packages/questpie"),
		temporary,
	);
	const archives = (await readdir(packed)).filter((name) =>
		name.endsWith(".tgz"),
	);
	if (archives.length !== 1)
		throw new Error("Expected one packed questpie archive");
	await writeFile(
		join(consumer, "package.json"),
		JSON.stringify({
			name: "native-docs-clean-consumer",
			private: true,
			type: "module",
			imports: { "#questpie/client": "./.questpie/generated/client.ts" },
			dependencies: {
				questpie: `file:${join(packed, archives[0]!)}`,
				react: "19.2.8",
				"react-dom": "19.2.8",
				"@tanstack/react-query": "5.102.8",
				"@types/react": "19.2.18",
				"@types/react-dom": "19.2.7",
				jsdom: "27.4.0",
				"@types/jsdom": "27.0.0",
			},
		}),
	);
	await writeFile(
		join(consumer, "questpie.json"),
		JSON.stringify({
			$schema: "https://questpie.dev/schema/application-v1.json",
			version: 1,
			application: { name: "barbershopSupport" },
			postgres: {
				schema: "barbershop_support",
				minimumMajor: 16,
				databaseCollation: "C.UTF-8",
				databaseCType: "C.UTF-8",
				extensions: [],
				physicalNames: {},
			},
			source: { root: "src", exclude: [] },
			packages: {},
		}),
	);
	const tsconfig = JSON.parse(nativeQueryDocsExample(guide, "tsconfig.json"));
	// The public configuration is checked unchanged, with only test entrypoints added.
	tsconfig.include.push("types.ts", "browser*.ts");
	await writeFile(join(consumer, "tsconfig.json"), JSON.stringify(tsconfig));
	for (const [source, paths] of [
		[
			prerequisite,
			[
				"src/context.ts",
				"src/data/tickets.ts",
				"src/data/comments.ts",
				"src/queries/ticket-detail.ts",
			],
		],
		[mutationGuide, ["src/data/policies.ts", "src/mutations/rename-ticket.ts"]],
		[guide, ["web/support-screen.tsx", "web/ticket-screen.tsx"]],
	] as const)
		for (const path of paths) {
			await mkdir(dirname(join(consumer, path)), { recursive: true });
			await writeFile(
				join(consumer, path),
				nativeQueryDocsExample(source, path),
			);
		}
	await cp(
		join(repository, "tests/support/native-query-docs-types.ts"),
		join(consumer, "types.ts"),
	);
	await runNativeQueryDocs(
		["bun", "install", "--ignore-scripts"],
		consumer,
		temporary,
	);
	await runNativeQueryDocs(
		["bun", "node_modules/questpie/dist/cli.js", "build"],
		consumer,
		temporary,
	);
	return consumer;
}
