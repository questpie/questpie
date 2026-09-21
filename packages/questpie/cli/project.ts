import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Initialize explicit configuration without replacing user source or installing dependencies. */
export async function initializeProject(
	root: string,
	name: string,
): Promise<void> {
	if (!/^[a-z][a-zA-Z0-9]{0,62}$/.test(name))
		throw new TypeError(
			"application name must be one lower-camel segment (1–63 ASCII characters)",
		);
	const postgresSchema = name.replace(
		/[A-Z]/g,
		(character) => `_${character.toLowerCase()}`,
	);
	if (
		postgresSchema.length > 63 ||
		postgresSchema.startsWith("pg_") ||
		postgresSchema.startsWith("questpie_") ||
		["public", "questpie_internal", "information_schema"].includes(
			postgresSchema,
		)
	)
		throw new TypeError(
			"application name produces an unsupported PostgreSQL schema name",
		);
	const configPath = join(root, "questpie.json");
	const typesPath = join(root, "tsconfig.json");
	if (await exists(configPath))
		throw new TypeError(
			"questpie.json already exists; init does not overwrite an application",
		);
	if (await exists(typesPath))
		throw new TypeError(
			"tsconfig.json already exists; merge the documented configuration manually",
		);
	const manifestPath = join(root, "package.json");
	const manifest = (await exists(manifestPath))
		? object(JSON.parse(await readFile(manifestPath, "utf8")), "package.json")
		: { name, private: true };
	if (manifest.type !== undefined && manifest.type !== "module")
		throw new TypeError('QUESTPIE requires package.json type "module"');
	const imports = object(manifest.imports ?? {}, "package imports");
	const generatedImports = {
		"#questpie/app": "./.questpie/generated/app.ts",
		"#questpie/client": "./.questpie/generated/client.ts",
		"#questpie/source/*": "./src/*",
	};
	for (const [key, value] of Object.entries(generatedImports))
		if (imports[key] !== undefined && imports[key] !== value)
			throw new TypeError(`conflicting generated import ${key}`);
	const scripts = object(manifest.scripts ?? {}, "package scripts");
	const gitignorePath = join(root, ".gitignore");
	const ignored = (await exists(gitignorePath))
		? await readFile(gitignorePath, "utf8")
		: "";
	const configuration = {
		$schema: "https://questpie.dev/schema/application-v1.json",
		version: 1,
		application: { name },
		postgres: {
			schema: postgresSchema,
			minimumMajor: 16,
			databaseCollation: "C.UTF-8",
			databaseCType: "C.UTF-8",
			extensions: [],
			physicalNames: {},
		},
		source: { root: "src", exclude: [] },
		packages: {},
	};
	const tsconfig = {
		compilerOptions: {
			module: "ESNext",
			moduleResolution: "Bundler",
			target: "ES2024",
			strict: true,
			noUncheckedIndexedAccess: true,
			noEmit: true,
			skipLibCheck: true,
			types: ["bun"],
			paths: Object.fromEntries(
				Object.entries(generatedImports).map(([key, value]) => [key, [value]]),
			),
		},
		include: ["src/**/*.ts", "web/**/*.ts", "scripts/**/*.ts"],
	};
	// Validate all owned file/configuration conflicts before the first write.
	for (const directory of [
		"src",
		"web",
		"packages",
		"questpie/migrations",
		"questpie/seeds",
	])
		await mkdir(join(root, directory), { recursive: true });
	await writeFile(configPath, `${JSON.stringify(configuration, null, 2)}\n`, {
		flag: "wx",
	});
	await writeFile(typesPath, `${JSON.stringify(tsconfig, null, 2)}\n`, {
		flag: "wx",
	});
	await writeFile(
		manifestPath,
		`${JSON.stringify({ ...manifest, private: manifest.private ?? true, type: "module", imports: { ...imports, ...generatedImports }, scripts: { build: "questpie build", check: "questpie check", "types:check": "tsc --noEmit", ...scripts } }, null, 2)}\n`,
	);
	const additions = ["node_modules/", ".questpie/"].filter(
		(line) => !ignored.split(/\r?\n/u).includes(line),
	);
	if (additions.length)
		await writeFile(
			gitignorePath,
			`${ignored}${ignored && !ignored.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`,
		);
}
