import { z } from "zod";

const RECIPE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)*$/;
const SEMVER_PATTERN =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SEMVER_RANGE_PATTERN =
	/^(?:[<>=~^]*\d+(?:\.\d+){0,2})(?:\s+[<>=~^]*\d+(?:\.\d+){0,2})*$/;
const WINDOWS_RESERVED_NAME =
	/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function pathProblem(value: string): string | undefined {
	if (!value) return "must not be empty";
	if (value.includes("\0")) return "must not contain a null byte";
	if (value.includes("\\")) return "must use forward slashes";
	if (
		value.startsWith("/") ||
		value.startsWith("~") ||
		/^[A-Za-z]:/.test(value)
	) {
		return "must be relative to the project root";
	}

	const segments = value.split("/");
	if (segments.some((segment) => segment === "" || segment === ".")) {
		return "must not contain empty or current-directory segments";
	}
	if (segments.includes("..")) return "must not traverse outside the project";
	if (segments.some((segment) => segment === ".generated")) {
		return "must not target generated output";
	}
	if (segments.some((segment) => segment === ".git")) {
		return "must not target Git metadata";
	}
	if (segments.some((segment) => segment.startsWith(".env"))) {
		return "must not target environment files";
	}
	if (segments.some((segment) => WINDOWS_RESERVED_NAME.test(segment))) {
		return "contains a reserved device name";
	}

	return undefined;
}

export const recipeRelativePathSchema = z.string().superRefine((value, ctx) => {
	const problem = pathProblem(value);
	if (problem) {
		ctx.addIssue({ code: "custom", message: problem });
	}
});

export const recipeSemverSchema = z
	.string()
	.regex(SEMVER_PATTERN, "must be an exact semantic version");

export const recipeSemverRangeSchema = z
	.string()
	.regex(SEMVER_RANGE_PATTERN, "must be a supported semantic version range");

export const recipeRuntimeSchema = z.strictObject({
	name: z.enum(["any", "tanstack-start", "next", "hono", "elysia"]),
	version: recipeSemverRangeSchema.optional(),
});

export const recipeCompatibilitySchema = z.strictObject({
	questpie: recipeSemverRangeSchema,
	runtimes: z.array(recipeRuntimeSchema).min(1),
	modules: z.record(z.string().min(1), recipeSemverRangeSchema).default({}),
});

export const recipeQualitySchema = z.enum([
	"official",
	"experimental",
	"community",
]);

export const recipeRiskSchema = z.enum(["standard", "security-sensitive"]);

export const recipeSurfaceSchema = z.enum(["server", "admin", "web", "mobile"]);

export const recipeVerificationProfileSchema = z.literal("app-check");

const capabilitySchema = z
	.string()
	.regex(CAPABILITY_PATTERN, "must be a stable capability name");

export const questpieRecipeMetadataSchema = z.strictObject({
	schemaVersion: z.literal(1),
	recipeVersion: recipeSemverSchema,
	compatibility: recipeCompatibilitySchema,
	aliases: z.array(z.string().trim().min(1)).default([]),
	useCases: z.array(z.string().trim().min(1)).default([]),
	requires: z.array(capabilitySchema).default([]),
	provides: z.array(capabilitySchema).min(1),
	conflicts: z.array(capabilitySchema).default([]),
	surfaces: z.array(recipeSurfaceSchema).min(1),
	quality: recipeQualitySchema,
	risk: recipeRiskSchema,
	verificationProfile: recipeVerificationProfileSchema,
});

export const recipeFileSchema = z.strictObject({
	path: recipeRelativePathSchema,
	type: z
		.string()
		.regex(/^registry:[a-z][a-z-]*$/, "must be a registry file type"),
	target: recipeRelativePathSchema,
	content: z.string().max(MAX_FILE_BYTES).optional(),
});

const questpieMetaEnvelopeSchema = z.looseObject({
	questpie: questpieRecipeMetadataSchema,
});

export const recipeItemSchema = z
	.looseObject({
		$schema: z.url().optional(),
		name: z.string().regex(RECIPE_NAME_PATTERN, "must be kebab-case"),
		type: z.literal("registry:item"),
		title: z.string().trim().min(1),
		description: z.string().trim().min(1),
		author: z.string().trim().min(1).optional(),
		dependencies: z.array(z.string().trim().min(1)).default([]),
		devDependencies: z.array(z.string().trim().min(1)).default([]),
		registryDependencies: z.array(z.string().trim().min(1)).default([]),
		files: z.array(recipeFileSchema).min(1).max(MAX_FILES),
		docs: z.string().optional(),
		categories: z.array(z.string().trim().min(1)).default([]),
		meta: questpieMetaEnvelopeSchema,
	})
	.superRefine((item, ctx) => {
		const targets = new Map<string, number>();
		let totalBytes = 0;

		for (const [index, file] of item.files.entries()) {
			const key = file.target.normalize("NFC").toLocaleLowerCase("en-US");
			const previous = targets.get(key);
			if (previous !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: `duplicates target from files.${previous}.target`,
					path: ["files", index, "target"],
				});
			}
			targets.set(key, index);
			totalBytes += Buffer.byteLength(file.content ?? "", "utf8");
		}

		if (totalBytes > MAX_TOTAL_BYTES) {
			ctx.addIssue({
				code: "custom",
				message: `total file content exceeds ${MAX_TOTAL_BYTES} bytes`,
				path: ["files"],
			});
		}
	});

export const recipeCatalogSchema = z
	.looseObject({
		$schema: z.url().optional(),
		name: z.string().trim().min(1),
		homepage: z.url().optional(),
		items: z.array(recipeItemSchema),
	})
	.superRefine((catalog, ctx) => {
		const names = new Map<string, number>();
		for (const [index, item] of catalog.items.entries()) {
			const key = item.name.normalize("NFC").toLocaleLowerCase("en-US");
			const previous = names.get(key);
			if (previous !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: `duplicates recipe identity from items.${previous}.name`,
					path: ["items", index, "name"],
				});
			}
			names.set(key, index);
		}
	});

export type RecipeCompatibilityV1 = z.infer<typeof recipeCompatibilitySchema>;
export type RecipeFileV1 = z.infer<typeof recipeFileSchema>;
export type RecipeItemV1 = z.infer<typeof recipeItemSchema>;
export type RecipeCatalogV1 = z.infer<typeof recipeCatalogSchema>;
export type RecipeQuality = z.infer<typeof recipeQualitySchema>;
export type RecipeRisk = z.infer<typeof recipeRiskSchema>;
export type RecipeSurface = z.infer<typeof recipeSurfaceSchema>;
export type RecipeVerificationProfile = z.infer<
	typeof recipeVerificationProfileSchema
>;
export type QuestpieRecipeMetadataV1 = z.infer<
	typeof questpieRecipeMetadataSchema
>;

function issuePath(path: PropertyKey[]): string {
	return path.map(String).join(".") || "catalog";
}

function itemName(input: unknown, path: PropertyKey[]): string | undefined {
	if (path[0] !== "items" || typeof path[1] !== "number") return undefined;
	if (!input || typeof input !== "object") return undefined;
	const items = Reflect.get(input, "items");
	if (!Array.isArray(items)) return undefined;
	const item = items[path[1]];
	if (!item || typeof item !== "object") return `items.${path[1]}`;
	const name = Reflect.get(item, "name");
	return typeof name === "string" && name ? name : `items.${path[1]}`;
}

export function parseRecipeCatalog(input: unknown): RecipeCatalogV1 {
	const result = recipeCatalogSchema.safeParse(input);
	if (result.success) return result.data;

	const details = result.error.issues.map((issue) => {
		const name = itemName(input, issue.path);
		return `${name ? `recipe "${name}"` : "catalog"} ${issuePath(issue.path)}: ${issue.message}`;
	});
	throw new Error(`Invalid QUESTPIE recipe catalog:\n${details.join("\n")}`, {
		cause: result.error,
	});
}
