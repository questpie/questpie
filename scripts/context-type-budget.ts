import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	symlinkSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

// Keep a package-consumer comparison separate from the app's inference-cycle gate.
const packagePath = process.argv[2];
if (!packagePath)
	throw new Error(
		"Usage: bun scripts/context-type-budget.ts <published-questpie-directory>",
	);
const root = mkdtempSync("/var/tmp/questpie-context-types-");
const compiler = resolve("node_modules/typescript/bin/tsc");
const version = spawnSync("node", [compiler, "--version"], {
	encoding: "utf8",
});
if (version.status !== 0) throw new Error(version.stderr);
const started = Date.now();
const results = [];
try {
	mkdirSync(join(root, "node_modules"));
	symlinkSync(resolve(packagePath), join(root, "node_modules/questpie"));
	for (const count of [10, 50, 100, 150]) {
		for (const kind of ["baseline", "shared"] as const) {
			const dir = join(root, `${count}-${kind}`);
			mkdirSync(dir);
			let code =
				'import { CollectionBuilder } from "questpie/builders";\nimport type { CollectionAPI } from "questpie/types";\n';
			for (let i = 0; i < count; i++)
				code += `const c${i} = CollectionBuilder.create("c${i}").fields(({f})=>({title:f.text().required(),slug${i}:f.text().required(),enabled:f.boolean().default(false),rank:f.number().default(0),state:f.select([{value:"draft",label:"Draft"},{value:"ready",label:"Ready"}]).required(),linked:f.relation("c${(i + 1) % count}")}));\n`;
			const members = Array.from(
				{ length: count },
				(_, i) => `c${i}:typeof c${i};`,
			).join("\n");
			code += `type AppCollections={${members}};\ntype JobDefinitions={} & {${members}};\n`;
			code += `type JobCollections={} & {${Array.from({ length: count }, (_, i) => `c${i}:CollectionAPI<typeof c${i},JobDefinitions>;`).join("\n")}};\n`;
			code +=
				kind === "shared"
					? "type ServiceCollections=JobCollections;\n"
					: "type ServiceCollections={[K in keyof AppCollections]:CollectionAPI<AppCollections[K],AppCollections>};\n";
			code += `declare const collections:JobCollections;
function consume(value:ServiceCollections){return value.c0.find({where:{title:{eq:"hello"}}});}
export const result=consume(collections);
const populated=collections.c0.find({with:{linked:true}});
populated.then(r=>r.docs[0]?.linked?.title);
// @ts-expect-error populated relation keeps target fields
populated.then(r=>r.docs[0]?.linked?.missing);
// @ts-expect-error text operator rejects number
collections.c0.find({where:{title:{eq:123}}});
// @ts-expect-error missing collection
collections.unknown.find({});
// @ts-expect-error select literals remain precise
collections.c0.find({where:{state:{eq:"missing"}}});
// @ts-expect-error create retains required fields
collections.c0.create({state:"draft"});
collections.c0.create({title:"hello",slug0:"hello",state:"draft"});
`;
			writeFileSync(join(dir, "fixture.ts"), code);
			writeFileSync(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "bundler",
						strict: true,
						skipLibCheck: true,
						noEmit: true,
						types: [],
					},
					files: ["fixture.ts"],
				}),
			);
			const remaining = 300_000 - (Date.now() - started);
			if (remaining <= 0)
				throw new Error("Comparison exceeded five-minute budget");
			const run = spawnSync(
				"node",
				[
					"--max-old-space-size=3072",
					compiler,
					"--noEmit",
					"--extendedDiagnostics",
					"-p",
					join(dir, "tsconfig.json"),
				],
				{
					encoding: "utf8",
					timeout: Math.min(45_000, remaining),
					maxBuffer: 4 * 1024 * 1024,
				},
			);
			const output = run.stdout + run.stderr;
			if (run.status !== 0)
				throw new Error(`${count}/${kind} failed or timed out:\n${output}`);
			const metric = (key: string) => {
				const value = Number(
					output.match(new RegExp(`^${key}:\\s+([\\d.]+)`, "m"))?.[1],
				);
				if (!Number.isFinite(value))
					throw new Error(`Missing diagnostic ${key}`);
				return value;
			};
			results.push({
				count,
				kind,
				types: metric("Types"),
				instantiations: metric("Instantiations"),
				memoryKiB: metric("Memory used"),
				checkSeconds: metric("Check time"),
				totalSeconds: metric("Total time"),
			});
			console.log(JSON.stringify(results.at(-1)));
		}
	}
	for (const count of [100, 150]) {
		const baseline = results.find(
			(row) => row.count === count && row.kind === "baseline",
		)!;
		const shared = results.find(
			(row) => row.count === count && row.kind === "shared",
		)!;
		if (shared.instantiations > baseline.instantiations * 0.4)
			throw new Error(
				`Shared contract lost its instantiation budget at ${count} collections`,
			);
	}
	console.log(
		JSON.stringify(
			{
				compiler: version.stdout.trim(),
				packagePath: resolve(packagePath),
				durationMs: Date.now() - started,
				results,
			},
			null,
			2,
		),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
