/**
 * Global Builder Type Tests
 *
 * These tests verify that TypeScript correctly infers types for global
 * (singleton) collections. Globals follow similar patterns to collections
 * but without pagination.
 *
 * Run with: tsc --noEmit
 */

import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, text, varchar } from "drizzle-orm/pg-core";
import type { GlobalBuilder } from "#questpie/server/global/builder/global-builder.js";
import { global } from "#questpie/server/global/builder/global-builder.js";
import type {
	Equal,
	Expect,
	Extends,
	HasKey,
	IsLiteral,
	IsNullable,
	OptionalKeys,
} from "./type-test-utils.js";

// ============================================================================
// Test fixtures
// ============================================================================

const settingsGlobal = global("settings").fields({
	siteName: varchar("site_name", { length: 255 }).notNull(),
	siteDescription: text("site_description"),
	maintenanceMode: boolean("maintenance_mode").default(false),
	maxUploadSize: integer("max_upload_size").default(10_000_000),
});

// ============================================================================
// global() factory tests
// ============================================================================

// Name should be inferred as literal type
const settings = global("settings");
type SettingsState = typeof settings extends GlobalBuilder<infer S> ? S : never;
type SettingsName = SettingsState["name"];

type _settingsNameIsLiteral = Expect<IsLiteral<SettingsName>>;
type _settingsNameValue = Expect<Equal<SettingsName, "settings">>;

// Empty global should initialize with empty state
const emptyGlobal = global("empty");
type EmptyState = typeof emptyGlobal extends GlobalBuilder<infer S> ? S : never;
type _emptyFieldsIsObject = Expect<Extends<EmptyState["fields"], object>>;

// ============================================================================
// .fields() method tests
// ============================================================================

// Fields should preserve types from Drizzle columns
const fieldsSettings = global("settings").fields({
	siteName: varchar("site_name", { length: 255 }).notNull(),
	maxUsers: integer("max_users"),
});

type FieldsState =
	typeof fieldsSettings extends GlobalBuilder<infer S> ? S : never;
type Fields = FieldsState["fields"];

type _hasSiteName = Expect<Equal<HasKey<Fields, "siteName">, true>>;
type _hasMaxUsers = Expect<Equal<HasKey<Fields, "maxUsers">, true>>;

// Select type should have correct nullability
type SettingsSelect = typeof settingsGlobal.$infer.select;

// Required non-null field
type _siteNameNotNull = Expect<Equal<SettingsSelect["siteName"], string>>;

// Nullable field (no .notNull())
type _descriptionNullable = Expect<
	IsNullable<SettingsSelect["siteDescription"]>
>;

// System fields should be present
type _selectHasId = Expect<Equal<HasKey<SettingsSelect, "id">, true>>;

// Update type should be partial
type SettingsUpdate = typeof settingsGlobal.$infer.update;
type SettingsOptional = OptionalKeys<SettingsUpdate>;

type _siteNameOptional = Expect<Extends<"siteName", SettingsOptional>>;
type _descriptionOptional = Expect<
	Extends<"siteDescription", SettingsOptional>
>;
type _maintenanceOptional = Expect<
	Extends<"maintenanceMode", SettingsOptional>
>;

// ============================================================================
// .hooks() method type tests
// ============================================================================

// Hooks should type data correctly
const hooksSettings = global("settings")
	.fields({
		siteName: text("site_name").notNull(),
		maintenanceMode: boolean("maintenance_mode"),
	})
	.hooks({
		afterChange: async ({ data }) => {
			// data should be select type
			const _id: string = data.id;
			const _siteName: string = data.siteName;
		},
	});

// ============================================================================
// .access() method type tests
// ============================================================================

// Access should type context with session
const accessSettings = global("settings")
	.fields({
		siteName: text("site_name"),
		adminOnly: boolean("admin_only"),
	})
	.access({
		read: ({ session }) => {
			// Anyone can read
			return true;
		},
		update: ({ session }) => {
			// Only authenticated users can update
			return !!session?.user;
		},
	});

// ============================================================================
// Complex global scenarios
// ============================================================================

// Full builder chain should work
const complexSettings = global("site_settings")
	.fields({
		siteName: varchar("site_name", { length: 255 }).notNull(),
		siteDescription: text("site_description"),
		maintenanceMode: boolean("maintenance_mode").default(false),
		config: jsonb("config").$type<{
			theme: string;
			features: string[];
		}>(),
	})
	.hooks({
		beforeChange: async ({ data }) => {
			// Can access data fields
		},
	})
	.access({
		read: true,
		update: ({ session }) => !!session?.user,
	});

type ComplexSelect = typeof complexSettings.$infer.select;

type _complexHasSiteName = Expect<
	Equal<HasKey<ComplexSelect, "siteName">, true>
>;
type _complexHasConfig = Expect<Equal<HasKey<ComplexSelect, "config">, true>>;

// JSONB type should be inferred correctly
const jsonbSettings = global("settings").fields({
	config: jsonb("config").$type<{
		theme: "light" | "dark";
		notifications: boolean;
	}>(),
});

type JsonbSelect = typeof jsonbSettings.$infer.select;
type ConfigType = JsonbSelect["config"];

type _configHasTheme = Expect<
	Extends<NonNullable<ConfigType>, { theme: "light" | "dark" }>
>;

// ============================================================================
// $infer helper tests
// ============================================================================

// $infer should provide select, insert, update types
const inferSettings = global("settings").fields({
	siteName: text("site_name").notNull(),
});

type Infer = typeof inferSettings.$infer;

type _inferHasSelect = Expect<Equal<HasKey<Infer, "select">, true>>;
type _inferHasInsert = Expect<Equal<HasKey<Infer, "insert">, true>>;
type _inferHasUpdate = Expect<Equal<HasKey<Infer, "update">, true>>;
