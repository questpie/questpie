/**
 * Module registry — declarative description of every QUESTPIE module the
 * scaffolder can wire into a generated project.
 *
 * Each entry is pure data. Adding a module = appending one entry; the
 * generators (`buildServerModules` / `buildAdminModules` / `updatePackageJson`)
 * iterate this list, so no generator code changes when the catalog grows.
 *
 * Lockstep rule (Better Auth's mirrored-plugin convention): a module with a
 * client half carries both `serverImport/Symbol` and `clientImport/Symbol`.
 * The client half is only emitted when admin is enabled — never one without
 * the other.
 */

export type RuntimeId = "tanstack-start" | "next" | "hono" | "elysia";

/** Runtimes that ship a render layer (admin UI can mount). */
export const RENDER_RUNTIMES: readonly RuntimeId[] = ["tanstack-start", "next"];

export type ModuleDefinition = {
	/** Stable id — also the multiselect value and `--module` flag token. */
	id: string;
	/** Human label for the prompt. */
	label: string;
	/** Optional one-line hint for the prompt. */
	hint?: string;
	/** Optional grouping key for grouped multiselect. */
	group?: string;
	/** Runtime postures this module is on-by-default for. */
	defaultFor?: RuntimeId[];
	/** When true, the module needs a render-layer runtime (admin UI). */
	requiresRender?: boolean;
	/** Dependencies this module adds (name -> version key into the version map handled by the caller). */
	deps: Record<string, string>;
	/** Server-side import specifier (the package path). */
	serverImport: string;
	/** Server-side named symbol imported from `serverImport`. */
	serverSymbol: string;
	/** Client-side import specifier (only modules with an admin/client half). */
	clientImport?: string;
	/** Client-side named symbol imported from `clientImport`. */
	clientSymbol?: string;
};

/**
 * The three already-wired modules. Import paths + symbols are copied verbatim
 * from the proven scaffolder emission (`buildServerModules` / `buildAdminModules`)
 * and the tanstack-start template's `server/modules.ts` + `admin/modules.ts`.
 */
export const modules: ModuleDefinition[] = [
	{
		id: "admin",
		label: "Admin",
		hint: "admin UI panel",
		group: "Core",
		defaultFor: ["tanstack-start", "next"],
		requiresRender: true,
		deps: { "@questpie/admin": "latest", "better-auth": "^1.6.11" },
		serverImport: "@questpie/admin/modules/admin",
		serverSymbol: "adminModule",
		clientImport: "@questpie/admin/client/modules/admin",
		clientSymbol: "adminClientModule",
	},
	{
		id: "openapi",
		label: "OpenAPI",
		hint: "REST + Scalar docs at /api/docs",
		group: "Core",
		defaultFor: ["tanstack-start", "next", "hono", "elysia"],
		deps: { "@questpie/openapi": "latest" },
		serverImport: "@questpie/openapi",
		serverSymbol: "openApiModule",
	},
	{
		id: "workflows",
		label: "Workflows",
		hint: "durable workflow engine",
		group: "Optional",
		deps: { "@questpie/workflows": "latest" },
		serverImport: "@questpie/workflows/modules/workflows",
		serverSymbol: "workflowsModule",
		clientImport: "@questpie/workflows/client/modules/workflows",
		clientSymbol: "workflowsClientModule",
	},
];

export function getModule(id: string): ModuleDefinition | undefined {
	return modules.find((m) => m.id === id);
}

/** Default module ids for a runtime posture (drives prompt pre-selection). */
export function defaultModuleIds(runtime: RuntimeId): string[] {
	return modules
		.filter((m) => m.defaultFor?.includes(runtime))
		.map((m) => m.id);
}

/**
 * Compatibility oracle — single source of truth for "can this module run on
 * this runtime?". Reused by the prompt filter AND flag validation so there is
 * zero rule duplication. Pure, no side effects.
 *
 * Rule (v1): a `requiresRender` module (admin) needs a render-layer runtime
 * (tanstack-start | next). Headless runtimes (hono | elysia) reject it.
 */
export function isModuleAllowed(moduleId: string, runtimeId: string): boolean {
	const mod = getModule(moduleId);
	if (!mod) return false;
	if (mod.requiresRender) {
		return RENDER_RUNTIMES.includes(runtimeId as RuntimeId);
	}
	return true;
}
