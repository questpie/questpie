/**
 * Admin Config DTO Types
 *
 * Typed interfaces for the admin config response shapes returned by
 * the getAdminConfig route. These define the discriminated/unified
 * shape that the admin client consumes.
 *
 * These types are the "wire format" — what the client receives.
 * They mirror the server augmentation types but are pure data
 * (no functions, no callbacks, no non-serializable fields).
 */

import { z } from "zod";

// ============================================================================
// Sidebar DTO
// ============================================================================

/**
 * Serialized sidebar item — discriminated union by `type`.
 */
export type SidebarItemDTO =
	| SidebarCollectionItemDTO
	| SidebarGlobalItemDTO
	| SidebarPageItemDTO
	| SidebarLinkItemDTO
	| SidebarDividerItemDTO;

export interface SidebarCollectionItemDTO {
	type: "collection";
	collection: string;
	label?: Record<string, string>;
	icon?: ComponentReferenceDTO;
}

export interface SidebarGlobalItemDTO {
	type: "global";
	global: string;
	label?: Record<string, string>;
	icon?: ComponentReferenceDTO;
}

export interface SidebarPageItemDTO {
	type: "page";
	pageId: string;
	label?: Record<string, string>;
	icon?: ComponentReferenceDTO;
}

export interface SidebarLinkItemDTO {
	type: "link";
	href: string;
	label: Record<string, string>;
	icon?: ComponentReferenceDTO;
	external?: boolean;
}

export interface SidebarDividerItemDTO {
	type: "divider";
}

export interface SidebarSectionDTO {
	id: string;
	title?: Record<string, string>;
	icon?: ComponentReferenceDTO;
	collapsible?: boolean;
	items?: SidebarItemDTO[];
	sections?: SidebarSectionDTO[];
}

export interface SidebarConfigDTO {
	sections: SidebarSectionDTO[];
}

// ============================================================================
// Shell DTO
// ============================================================================

export interface AdminShellRouteRulesDTO {
	include?: string[];
	exclude?: string[];
	match?: "prefix" | "exact";
}

export interface AdminShellRailDTO {
	component: ComponentReferenceDTO;
	placement?: "left" | "right";
	width?: number | string;
	minWidth?: number | string;
	maxWidth?: number | string;
	hiddenOnMobile?: boolean;
	routes?: AdminShellRouteRulesDTO;
	className?: string;
}

export interface AdminShellConfigDTO {
	secondaryRail?: AdminShellRailDTO;
}

// ============================================================================
// Dashboard DTO
// ============================================================================

/**
 * Serialized dashboard widget — discriminated union by `type`.
 * Non-serializable fields (loader, access, filterFn) are stripped.
 * `hasLoader: true` signals that the client should call fetchWidgetData.
 */
export interface DashboardWidgetDTO {
	type: string;
	id?: string;
	title?: Record<string, string>;
	description?: Record<string, string>;
	hasLoader?: boolean;
	collection?: string;
	/** Remaining widget-specific properties */
	[key: string]: unknown;
}

export interface DashboardSectionDTO {
	type: "section";
	label?: Record<string, string>;
	layout?: string;
	columns?: number;
	rowHeight?: number | string;
	gap?: number;
	items: DashboardWidgetDTO[];
}

export interface DashboardTabDTO {
	id: string;
	label: Record<string, string>;
	columns?: number;
	rowHeight?: number | string;
	gap?: number;
	items: DashboardWidgetDTO[];
}

export interface DashboardTabsDTO {
	type: "tabs";
	tabs: DashboardTabDTO[];
	defaultTab?: string;
}

export type DashboardItemDTO =
	| DashboardWidgetDTO
	| DashboardSectionDTO
	| DashboardTabsDTO;

export interface DashboardConfigDTO {
	title?: Record<string, string>;
	description?: Record<string, string>;
	columns?: number;
	rowHeight?: number | string;
	gap?: number;
	realtime?: boolean;
	actions?: unknown[];
	items?: DashboardItemDTO[];
}

// ============================================================================
// Branding DTO
// ============================================================================

export type BrandLogoDTO =
	| string
	| {
			src: string;
			srcDark?: string;
			alt?: string;
			width?: number;
			height?: number;
	  }
	| ComponentReferenceDTO;

export type I18nTextDTO = string | Record<string, string>;

export interface BrandingConfigDTO {
	name?: I18nTextDTO;
	logo?: BrandLogoDTO;
	tagline?: I18nTextDTO;
	favicon?: string;
}

// ============================================================================
// Collection/Global Metadata DTO
// ============================================================================

export interface WorkflowMetaDTO {
	enabled: boolean;
	initialStage: string;
	stages: Array<{
		name: string;
		label?: string;
		description?: string;
		transitions?: string[];
	}>;
}

export interface CollectionMetaDTO {
	label?: Record<string, string>;
	description?: Record<string, string>;
	icon?: ComponentReferenceDTO;
	hidden?: boolean;
	group?: string;
	order?: number;
	workflow?: WorkflowMetaDTO;
}

export interface GlobalMetaDTO {
	label?: Record<string, string>;
	description?: Record<string, string>;
	icon?: ComponentReferenceDTO;
	hidden?: boolean;
	group?: string;
	order?: number;
	workflow?: WorkflowMetaDTO;
}

// ============================================================================
// Component Reference DTO
// ============================================================================

export interface ComponentReferenceDTO {
	type: string;
	props?: Record<string, unknown>;
}

// ============================================================================
// Uploads DTO
// ============================================================================

export interface UploadsConfigDTO {
	collections: string[];
	defaultCollection?: string;
}

// ============================================================================
// Top-Level Admin Config DTO
// ============================================================================

/**
 * The complete admin config response shape returned by getAdminConfig.
 * This is the single source of truth for what the admin client receives.
 */
export interface AdminConfigDTO {
	dashboard?: DashboardConfigDTO;
	sidebar?: SidebarConfigDTO;
	shell?: AdminShellConfigDTO;
	branding?: BrandingConfigDTO;
	blocks?: Record<string, BlockSchemaDTO>;
	collections?: Record<string, CollectionMetaDTO>;
	globals?: Record<string, GlobalMetaDTO>;
	uploads?: UploadsConfigDTO;
}

export interface BlockSchemaDTO {
	name: string;
	admin?: {
		label?: unknown;
		description?: unknown;
		icon?: ComponentReferenceDTO;
		category?: {
			label: unknown;
			icon?: ComponentReferenceDTO;
			order?: number;
		};
		order?: number;
		hidden?: boolean;
	};
	allowChildren?: boolean;
	maxChildren?: number;
	hasPrefetch: boolean;
	fields: Record<string, unknown>;
	form?: { fields: unknown[] };
}

// ============================================================================
// Zod Schemas for DTO validation
// ============================================================================

function containsFunction(
	value: unknown,
	seen = new WeakSet<object>(),
): boolean {
	if (typeof value === "function") return true;
	if (!value || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) {
		return value.some((item) => containsFunction(item, seen));
	}
	return Object.values(value).some((item) => containsFunction(item, seen));
}

const serializableUnknownSchema = z
	.unknown()
	.refine((value) => !containsFunction(value), {
		message: "Functions cannot be serialized in admin config DTOs",
	});

const componentReferenceSchema = z.object({
	type: z.string(),
	props: z.record(z.string(), serializableUnknownSchema).optional(),
});

const sidebarItemSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("collection"),
		collection: z.string(),
		label: z.record(z.string(), z.string()).optional(),
		icon: componentReferenceSchema.optional(),
	}),
	z.object({
		type: z.literal("global"),
		global: z.string(),
		label: z.record(z.string(), z.string()).optional(),
		icon: componentReferenceSchema.optional(),
	}),
	z.object({
		type: z.literal("page"),
		pageId: z.string(),
		label: z.record(z.string(), z.string()).optional(),
		icon: componentReferenceSchema.optional(),
	}),
	z.object({
		type: z.literal("link"),
		href: z.string(),
		label: z.record(z.string(), z.string()),
		icon: componentReferenceSchema.optional(),
		external: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("divider"),
	}),
]);

const sidebarSectionSchema: z.ZodType<SidebarSectionDTO> = z.lazy(() =>
	z.object({
		id: z.string(),
		title: z.record(z.string(), z.string()).optional(),
		icon: componentReferenceSchema.optional(),
		collapsible: z.boolean().optional(),
		items: z.array(sidebarItemSchema).optional(),
		sections: z.array(sidebarSectionSchema).optional(),
	}),
);

const sidebarConfigSchema = z.object({
	sections: z.array(sidebarSectionSchema),
});

const adminShellRouteRulesSchema = z.object({
	include: z.array(z.string()).optional(),
	exclude: z.array(z.string()).optional(),
	match: z.enum(["prefix", "exact"]).optional(),
});

const adminShellRailSchema = z.object({
	component: componentReferenceSchema,
	placement: z.enum(["left", "right"]).optional(),
	width: z.union([z.number(), z.string()]).optional(),
	minWidth: z.union([z.number(), z.string()]).optional(),
	maxWidth: z.union([z.number(), z.string()]).optional(),
	hiddenOnMobile: z.boolean().optional(),
	routes: adminShellRouteRulesSchema.optional(),
	className: z.string().optional(),
});

const adminShellConfigSchema = z.object({
	secondaryRail: adminShellRailSchema.optional(),
});

const workflowMetaSchema = z.object({
	enabled: z.boolean(),
	initialStage: z.string(),
	stages: z.array(
		z.object({
			name: z.string(),
			label: z.string().optional(),
			description: z.string().optional(),
			transitions: z.array(z.string()).optional(),
		}),
	),
});

const collectionMetaSchema = z.object({
	label: z.record(z.string(), z.string()).optional(),
	description: z.record(z.string(), z.string()).optional(),
	icon: componentReferenceSchema.optional(),
	hidden: z.boolean().optional(),
	group: z.string().optional(),
	order: z.number().optional(),
	workflow: workflowMetaSchema.optional(),
});

const uploadsConfigSchema = z.object({
	collections: z.array(z.string()),
	defaultCollection: z.string().optional(),
});

const dashboardConfigSchema = z.object({
	title: z.record(z.string(), z.string()).optional(),
	description: z.record(z.string(), z.string()).optional(),
	columns: z.number().optional(),
	rowHeight: z.union([z.number(), z.string()]).optional(),
	gap: z.number().optional(),
	realtime: z.boolean().optional(),
	actions: z.array(serializableUnknownSchema).optional(),
	items: z.array(z.record(z.string(), serializableUnknownSchema)).optional(),
});

const brandLogoSchema = z.union([
	z.string(),
	z.object({
		src: z.string(),
		srcDark: z.string().optional(),
		alt: z.string().optional(),
		width: z.number().optional(),
		height: z.number().optional(),
	}),
	componentReferenceSchema,
]);

const i18nTextSchema = z.union([z.string(), z.record(z.string(), z.string())]);

const brandingConfigSchema = z.object({
	name: i18nTextSchema.optional(),
	logo: brandLogoSchema.optional(),
	tagline: i18nTextSchema.optional(),
	favicon: z.string().optional(),
});

const blockAdminSchema = z.object({
	label: serializableUnknownSchema.optional(),
	description: serializableUnknownSchema.optional(),
	icon: componentReferenceSchema.optional(),
	category: z
		.object({
			label: serializableUnknownSchema,
			icon: componentReferenceSchema.optional(),
			order: z.number().optional(),
		})
		.optional(),
	order: z.number().optional(),
	hidden: z.boolean().optional(),
});

const blockSchema = z.object({
	name: z.string(),
	admin: blockAdminSchema.optional(),
	allowChildren: z.boolean().optional(),
	maxChildren: z.number().optional(),
	hasPrefetch: z.boolean(),
	fields: z.record(z.string(), serializableUnknownSchema),
	form: z
		.object({
			fields: z.array(serializableUnknownSchema),
		})
		.optional(),
});

/**
 * Zod schema for the complete AdminConfigDTO.
 * Can be used as the outputSchema for the getAdminConfig route.
 */
export const adminConfigDTOSchema = z.object({
	dashboard: dashboardConfigSchema.optional(),
	sidebar: sidebarConfigSchema.optional(),
	shell: adminShellConfigSchema.optional(),
	branding: brandingConfigSchema.optional(),
	blocks: z.record(z.string(), blockSchema).optional(),
	collections: z.record(z.string(), collectionMetaSchema).optional(),
	globals: z.record(z.string(), collectionMetaSchema).optional(),
	uploads: uploadsConfigSchema.optional(),
});
