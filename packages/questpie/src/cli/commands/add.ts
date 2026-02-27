/**
 * questpie add <type> <name>
 *
 * Scaffold a new entity file in the correct directory and auto-run codegen.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveEntityRoot } from "./codegen.js";
import { generateCommand } from "./codegen.js";

// ============================================================================
// Types
// ============================================================================

export interface AddOptions {
	configPath: string;
	type: string;
	name: string;
	dryRun?: boolean;
}

interface EntityTypeConfig {
	/** Subdirectory relative to entity root */
	dir: string;
	/** Derive filename from kebab name */
	getFilename: (kebab: string) => string;
	/** Generate file content */
	template: (ctx: { kebab: string; camel: string; title: string }) => string;
}

// ============================================================================
// Entity type registry
// ============================================================================

const ENTITY_TYPES: Record<string, EntityTypeConfig> = {
	collection: {
		dir: "collections",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ kebab, camel }) => `import { collection } from "questpie";

export const ${camel} = collection("${kebab}")
	.fields(({ f }) => ({
		title: f.text("Title"),
	}))
	.title(({ f }) => f.title);
`,
	},

	global: {
		dir: "globals",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ kebab, camel }) => `import { global } from "questpie";

export const ${camel} = global("${kebab}")
	.fields(({ f }) => ({
		title: f.text("Title"),
	}));
`,
	},

	fn: {
		dir: "functions",
		getFilename: (kebab) => `${kebab}.ts`,
		template: () => `import { fn } from "questpie";
import { z } from "zod";

export default fn({
	schema: z.object({}),
	handler: async ({ input, ctx }) => {
		return {};
	},
});
`,
	},

	job: {
		dir: "jobs",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ kebab }) => `import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "${kebab}",
	schema: z.object({}),
	handler: async ({ payload, ctx }) => {},
});
`,
	},

	service: {
		dir: "services",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ camel }) => `import { service } from "questpie";

export const ${camel}Service = service({
	setup: async ({ ctx }) => {
		return {};
	},
});
`,
	},

	block: {
		dir: "blocks",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ kebab, camel }) => `import { collection } from "questpie";

// Server-side block definition
export const ${camel}Block = {
	name: "${kebab}",
	// TODO: define block fields
};
`,
	},

	email: {
		dir: "emails",
		getFilename: (kebab) => `${kebab}.tsx`,
		template: ({ camel, title }) => `import { email } from "questpie";

export default email({
	subject: () => "${title}",
	render: async (props: {}) => {
		return <div>{/* TODO: implement ${camel} email template */}</div>;
	},
});
`,
	},

	route: {
		dir: "routes",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ kebab }) => `import { route } from "questpie";

export default route("GET", "/${kebab}", async ({ ctx }) => {
	return Response.json({});
});
`,
	},

	seed: {
		dir: "seeds",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ camel }) => `import { seed } from "questpie";

export default seed({
	id: "${camel}",
	description: "TODO: describe what this seed does",
	category: "dev",
	async run({ collections, globals, createContext, log }) {
		log("Running ${camel} seed...");
		// await collections.myCollection.create({ ... })
		// await globals.siteSettings.update({ ... })
		// For locale-specific: const ctxSk = await createContext({ locale: "sk" })
	},
});
`,
	},

	migration: {
		dir: "migrations",
		getFilename: (kebab) => `${kebab}.ts`,
		template: ({ camel }) => {
			const timestamp = new Date()
				.toISOString()
				.replace(/[-:]/g, "")
				.replace(/\..+/, "")
				.slice(0, 15);
			return `import { migration } from "questpie";
import { sql } from "drizzle-orm";

export default migration({
	id: "${camel}${timestamp}",
	async up({ db }) {
		// TODO: implement migration
	},
	async down({ db }) {
		// TODO: implement rollback
	},
});
`;
		},
	},
};

// ============================================================================
// Main command
// ============================================================================

export async function addCommand(options: AddOptions): Promise<void> {
	const typeConfig = ENTITY_TYPES[options.type];
	if (!typeConfig) {
		const supported = Object.keys(ENTITY_TYPES).join(", ");
		throw new Error(
			`Unknown entity type: "${options.type}". Supported types: ${supported}`,
		);
	}

	// Resolve entity root directory
	const rawConfigPath = resolve(process.cwd(), options.configPath);
	const { rootDir } = await resolveEntityRoot(rawConfigPath);

	// Convert name to filename and variable name
	const kebabName = toKebabCase(options.name);
	const camelName = toCamelCase(options.name);
	const titleName = toTitleCase(options.name);

	const filename = typeConfig.getFilename(kebabName);
	const outDir = join(rootDir, typeConfig.dir);
	const filePath = join(outDir, filename);

	console.log(`Adding ${options.type}: ${options.name}`);
	console.log(`  File: ${filePath}`);

	if (options.dryRun) {
		console.log("\n--- Would create (dry run) ---\n");
		console.log(typeConfig.template({ kebab: kebabName, camel: camelName, title: titleName }));
		return;
	}

	// Check if file already exists
	if (existsSync(filePath)) {
		throw new Error(`File already exists: ${filePath}`);
	}

	// Create directory if needed
	mkdirSync(outDir, { recursive: true });

	// Write file
	const content = typeConfig.template({ kebab: kebabName, camel: camelName, title: titleName });
	writeFileSync(filePath, content, "utf-8");
	console.log(`Created: ${filePath}`);

	// Auto-run codegen to update .generated/index.ts
	console.log("\nUpdating .generated/index.ts...");
	await generateCommand({ configPath: options.configPath });
}

// ============================================================================
// Name conversion helpers
// ============================================================================

function toKebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "");
}

function toCamelCase(str: string): string {
	const kebab = toKebabCase(str);
	return kebab.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function toTitleCase(str: string): string {
	return toKebabCase(str)
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
