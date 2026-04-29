# Registry Unification Plan

## Problem Statement

The codegen system has **two completely separate paths** to Registry augmentation, **dead code** on CategoryDeclaration.registryKey, **hardcoded special cases**, and **inconsistent treatment** of different entity types. The result: views/blocks/components work fundamentally differently from collections/globals/jobs, even though they should all follow the same principle.

### Current State of Chaos

| Issue                                             | Description                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CategoryDeclaration.registryKey` is DEAD CODE    | Declared as `true` on all 10 core categories but NEVER consumed by any template for Registry augmentation |
| `moduleRegistries` is separate mechanism          | Admin plugin uses a completely different path to write Registry augmentation                              |
| Views use `discover` not `categories` on server   | `"views/*.ts"` is a discover pattern, not a CategoryDeclaration — has no metadata                         |
| `listViews`/`formViews` are derived via transform | Runtime `filterViewsByKind()` + `addRuntimeCode()` instead of proper categories                           |
| `~fieldTypes` is hardcoded                        | Always emitted in module-template regardless of declarations                                              |
| `auth` is hardcoded                               | Special-case scanning in discover.ts, not a standard discover single                                      |
| Two placeholder systems                           | Core categories have no placeholder support; admin uses `$VIEW_NAMES`, `$COMPONENTS` etc.                 |
| `keyFromProperty` only works in custom generator  | Standard templates ignore it                                                                              |
| Blocks have no registryKey                        | Server-side blocks don't augment Registry, unlike components                                              |

---

## Design Principle

**ONE mechanism for everything**: `CategoryDeclaration` is the single source of truth. It drives discovery, Registry augmentation, type emission, factory type consumption, and module template generation. No `moduleRegistries`. No special cases. No dual paths.

**The chain**: `CategoryDeclaration` → `module-template.ts` writes to `Registry` → `factory-template.ts` reads from `Registry` via `_RegistryProp<K>`

---

## Phase 1: Make CategoryDeclaration.registryKey Actually Work

### Goal

Make `module-template.ts` read `registryKey` from `CategoryDeclaration` and emit Registry augmentation for ALL categories that have it.

### Current State

- `module-template.ts` only does Registry augmentation via `moduleRegistries` (lines 398-453)
- `CategoryDeclaration.registryKey` is set to `true` on collections, globals, jobs, functions, routes, services but NEVER read by any template

### Changes

#### 1.1 Extend CategoryDeclaration with placeholder support

**File**: `packages/questpie/src/cli/codegen/types.ts`

Add to `CategoryDeclaration`:

```ts
interface CategoryDeclaration {
	// ... existing fields ...

	/** Placeholder token for name union in configType strings (e.g. "$COLLECTION_NAMES") */
	placeholder?: string;
	/** Placeholder token for full record type in configType strings (e.g. "$COLLECTIONS") */
	recordPlaceholder?: string;
	/** Type registry interface to augment (e.g. { module: "@questpie/admin/server", interface: "ComponentTypeRegistry" }) */
	typeRegistry?: { module: string; interface: string };
	/**
	 * When category is derived from another category via transform (e.g. listViews from views),
	 * specifies the source category and how the derivation works.
	 * The transform still runs, but this metadata tells module-template how to handle Registry.
	 */
	derivedFrom?: {
		sourceCategory: string;
		extractedConstPrefix: string;
	};
}
```

#### 1.2 Update module-template.ts to use CategoryDeclaration for Registry

**File**: `packages/questpie/src/cli/codegen/module-template.ts`

Replace the `moduleRegistries`-driven Registry augmentation loop with a generic loop over ALL categories that have `registryKey`:

```ts
// For each category with registryKey, emit Registry augmentation
for (const [catName, declaration] of categories) {
	if (!declaration.registryKey) continue;
	const registryKeyName =
		typeof declaration.registryKey === "string"
			? declaration.registryKey
			: catName;

	// Check if this is an extracted const (derived category like listViews/formViews)
	// or a normal category with a named type interface
	if (declaration.derivedFrom) {
		// Use extracted const: typeof _reg_listViews & Record<string, unknown>
		registryLines.push(
			`${registryKeyName}: typeof _reg_${catName} & Record<string, unknown>;`,
		);
	} else if (declaration.typeEmit !== "none") {
		// Use named type interface: AdminCollections & Record<string, unknown>
		registryLines.push(
			`${registryKeyName}: ${typeInterfaceName} & Record<string, unknown>;`,
		);
	}
}
```

#### 1.3 Update factory-template.ts to read from CategoryDeclaration

**File**: `packages/questpie/src/cli/codegen/factory-template.ts`

Replace `moduleRegistries`-driven type alias generation with a loop over categories that have `placeholder` or `recordPlaceholder`:

```ts
// For each category with placeholder, generate type alias reading from Registry
for (const [catName, declaration] of allCategories) {
	const registryKeyName =
		typeof declaration.registryKey === "string"
			? declaration.registryKey
			: catName;
	if (declaration.placeholder) {
		lines.push(
			`type _${pascal(catName)}Names = (keyof _RegistryProp<"${registryKeyName}"> & string) | (string & {});`,
		);
	}
	if (declaration.recordPlaceholder) {
		lines.push(
			`type _${pascal(catName)}Record = _RegistryProp<"${registryKeyName}">;`,
		);
	}
}
```

And `buildPlaceholderMap()` reads from categories instead of `moduleRegistries`:

```ts
function buildPlaceholderMap(
	categories: Map<string, CategoryDeclaration>,
): Map<string, string> {
	const map = new Map();
	for (const [catName, decl] of categories) {
		if (decl.placeholder) map.set(decl.placeholder, `_${pascal(catName)}Names`);
		if (decl.recordPlaceholder)
			map.set(decl.recordPlaceholder, `_${pascal(catName)}Record`);
	}
	return map;
}
```

---

## Phase 2: Promote Views/Blocks/Components from `discover` to `categories` on Server Target

### Goal

Views, blocks, and components become proper `CategoryDeclaration` entries on the server target, with all the metadata they need.

### Changes

#### 2.1 Move views/blocks/components from `discover` to `categories` in admin plugin

**File**: `packages/admin/src/server/plugin.ts`

Before:

```ts
discover: {
  views: "views/*.ts",
  components: "components/*.ts",
  blocks: "blocks/*.ts",
  sidebar: "sidebar.ts",
  // ...
}
```

After:

```ts
categories: {
  views: {
    dirs: ["views"],
    prefix: "view",
    registryKey: true,
    placeholder: "$VIEW_NAMES",
    includeInAppState: true,
    extractFromModules: true,
    typeEmit: "standard",
  },
  listViews: {
    dirs: [],  // no own directory — derived from views
    prefix: "lv",
    registryKey: true,
    placeholder: "$LIST_VIEW_NAMES",
    recordPlaceholder: "$LIST_VIEWS",
    includeInAppState: false,
    extractFromModules: false,
    typeEmit: "none",
    derivedFrom: { sourceCategory: "views", extractedConstPrefix: "_reg" },
  },
  formViews: {
    dirs: [],  // derived from views
    prefix: "fv",
    registryKey: true,
    placeholder: "$FORM_VIEW_NAMES",
    recordPlaceholder: "$FORM_VIEWS",
    includeInAppState: false,
    extractFromModules: false,
    typeEmit: "none",
    derivedFrom: { sourceCategory: "views", extractedConstPrefix: "_reg" },
  },
  components: {
    dirs: ["components"],
    prefix: "comp",
    registryKey: true,
    placeholder: "$COMPONENT_NAMES",
    recordPlaceholder: "$COMPONENTS",
    typeRegistry: { module: "@questpie/admin/server", interface: "ComponentTypeRegistry" },
    includeInAppState: true,
    extractFromModules: true,
    typeEmit: "standard",
  },
  blocks: {
    dirs: ["blocks"],
    prefix: "bloc",
    registryKey: true,
    includeInAppState: true,
    extractFromModules: true,
    typeEmit: "standard",
  },
},
discover: {
  // Only singleton files remain here
  sidebar: "sidebar.ts",
  dashboard: "dashboard.ts",
  branding: "branding.ts",
  adminLocale: "admin-locale.ts",
}
```

#### 2.2 Keep the transform for listViews/formViews derivation

The transform still calls `filterViewsByKind()` and `addRuntimeCode()`. But now `listViews` and `formViews` are proper CategoryDeclarations with `derivedFrom`, so the module-template knows to:

1. Use the extracted const pattern (`_reg_listViews`)
2. Emit Registry augmentation with `typeof _reg_listViews`
3. NOT try to discover files for them (empty `dirs`)

#### 2.3 Remove `moduleRegistries` from admin plugin

Delete the entire `registries.moduleRegistries` block from plugin.ts. All that metadata is now on the CategoryDeclarations.

---

## Phase 3: Remove `moduleRegistries` from the Codegen System

### Goal

Delete `moduleRegistries` as a concept. Everything goes through `CategoryDeclaration`.

### Changes

#### 3.1 Remove ModuleRegistryConfig type

**File**: `packages/questpie/src/cli/codegen/types.ts`

Delete `ModuleRegistryConfig` interface. Delete `moduleRegistries` from `CodegenTargetContribution.registries`. Keep `collectionExtensions`, `globalExtensions`, `singletonFactories`, `callbackParams` — these are orthogonal concepts (builder extension methods, not registry augmentation).

#### 3.2 Update resolveTargetGraph()

**File**: `packages/questpie/src/cli/codegen/index.ts`

Remove `moduleRegistries` merging logic. Categories already merge via `Object.assign`.

#### 3.3 Update module-template.ts

Remove all `moduleRegistries`-specific code:

- Remove the `moduleRegistries` parameter
- Remove `extractedConsts` detection from `extraModuleProperties` matching `moduleRegistries` keys
- Replace with: `extractedConsts` detection for categories with `derivedFrom`
- Registry augmentation loop iterates `categories` only

#### 3.4 Update factory-template.ts

Remove all `moduleRegistries`-specific code:

- Remove type alias generation from `moduleRegistries`
- Replace with category-driven type alias generation
- `buildPlaceholderMap()` reads from categories

---

## Phase 4: Make `~fieldTypes` Declarative

### Goal

Remove the hardcoded `~fieldTypes` emission from module-template. Make it driven by CategoryDeclaration or DiscoverPattern metadata.

### Changes

#### 4.1 Add `registryAugmentation` to DiscoverPattern

**File**: `packages/questpie/src/cli/codegen/types.ts`

```ts
interface DiscoverSinglePattern {
	pattern: string;
	/** If set, augments Registry with `typeof` this single under the given key */
	registryKey?: string;
}
```

#### 4.2 Update core plugin's `fields` discovery

**File**: `packages/questpie/src/cli/codegen/index.ts`

```ts
discover: {
  fields: { pattern: "fields.ts", registryKey: "~fieldTypes" },
  locale: "locale.ts",
  hooks: "hooks.ts",
  // ...
}
```

#### 4.3 Update module-template.ts

Remove the hardcoded `~fieldTypes` block (lines 429-437). Replace with generic handling:

```ts
// For each single with registryKey, emit Registry augmentation
for (const [singleName, pattern] of discoverPatterns) {
	if (
		typeof pattern === "object" &&
		pattern.registryKey &&
		discovered.singles.has(singleName)
	) {
		registryLines.push(
			`"${pattern.registryKey}": typeof ${discovered.singles.get(singleName).varName};`,
		);
	}
}
```

---

## Phase 5: Make `auth` a Standard Discover Single

### Goal

Remove hardcoded auth scanning from discover.ts.

### Changes

#### 5.1 Move auth to discover patterns in core plugin

**File**: `packages/questpie/src/cli/codegen/index.ts`

```ts
discover: {
  auth: "auth.ts",
  fields: { pattern: "fields.ts", registryKey: "~fieldTypes" },
  locale: "locale.ts",
  hooks: "hooks.ts",
  defaultAccess: "access.ts",
  contextResolver: "context.ts",
}
```

#### 5.2 Remove hardcoded auth scan from discover.ts

**File**: `packages/questpie/src/cli/codegen/discover.ts`

Delete the "Phase 2: Auth" section (lines 256-274). Auth is now found by the generic single-file discovery in Phase 3.

#### 5.3 Update templates

`template.ts` and `module-template.ts` reference `discovered.auth` — change these to `discovered.singles.get("auth")`. The generated code stays the same, just the discovery path becomes consistent.

---

## Phase 6: Make `keyFromProperty` Work in Standard Templates

### Goal

`keyFromProperty` should work in `module-template.ts` and `template.ts`, not just in the custom admin-client generator.

### Changes

#### 6.1 Update module-template.ts category emission

**File**: `packages/questpie/src/cli/codegen/module-template.ts`

In the category emission loop (lines 280-344), when generating object entries:

```ts
// Current: always uses file key
`${file.key}: ${file.varName}`;

// New: respect keyFromProperty
if (declaration.keyFromProperty) {
	`[${file.varName}.${declaration.keyFromProperty}]: ${file.varName}`;
} else {
	`${file.key}: ${file.varName}`;
}
```

#### 6.2 Update template.ts similarly

Same change in the root app template's category emission.

---

## Phase 7: Cleanup and Consistency Pass

### 7.1 Remove `emails` special casing

- Set `extractFromModules: true` on emails category so modules CAN contribute emails
- Remove the `createAppKey: "emailTemplates"` rename — use `emails` everywhere (or rename the directory to `email-templates/` if the rename is needed for clarity)
- Set `includeInAppState: true` so emails appear in `_AppInternal`

### 7.2 Audit `appContextEmit`

Currently only services have `appContextEmit: "services"` which flattens them onto AppContext. This is acceptable as a service-specific feature, but document it clearly. Consider whether other categories could benefit (probably not — services are special because they're singletons accessed via `ctx.serviceName`).

### 7.3 Clean up `registries` type

After removing `moduleRegistries`, the `registries` field on `CodegenTargetContribution` becomes:

```ts
registries?: {
  collectionExtensions?: Record<string, ExtensionConfig>;
  globalExtensions?: Record<string, ExtensionConfig>;
  singletonFactories?: Record<string, SingletonFactoryConfig>;
  callbackParams?: Record<string, string>;
  // moduleRegistries DELETED
}
```

### 7.4 Update all tests

- `packages/questpie/test/codegen/template.test.ts`
- `packages/questpie/test/codegen/scaffolds.test.ts`
- `packages/admin/test/builder/*.test.ts`
- `packages/admin/test/server/codegen.test.ts`

### 7.5 Regenerate all .generated/ files

After all changes, run `questpie generate` to regenerate:

- `packages/questpie/src/server/modules/starter/.generated/module.ts`
- `packages/questpie/src/server/modules/core/.generated/module.ts`
- `packages/admin/src/server/modules/admin/.generated/module.ts`
- `packages/admin/src/server/modules/admin/client/.generated/module.ts`
- `packages/admin/src/server/modules/audit/.generated/module.ts`
- `packages/admin/src/server/modules/admin-preferences/.generated/module.ts`
- `examples/tanstack-barbershop/src/questpie/server/.generated/index.ts`
- `examples/tanstack-barbershop/src/questpie/server/.generated/factories.ts`
- `examples/tanstack-barbershop/src/questpie/admin/.generated/client.ts`

---

## Execution Order

```
Phase 1: CategoryDeclaration.registryKey works
  ├── 1.1 Extend CategoryDeclaration type
  ├── 1.2 Update module-template.ts
  └── 1.3 Update factory-template.ts

Phase 2: Views/Blocks/Components → proper categories
  ├── 2.1 Move from discover to categories in admin plugin
  ├── 2.2 Keep transform for derived categories
  └── 2.3 Remove moduleRegistries from admin plugin

Phase 3: Delete moduleRegistries entirely
  ├── 3.1 Remove ModuleRegistryConfig type
  ├── 3.2 Update resolveTargetGraph()
  ├── 3.3 Update module-template.ts
  └── 3.4 Update factory-template.ts

Phase 4: ~fieldTypes declarative
  ├── 4.1 Add registryKey to DiscoverPattern
  ├── 4.2 Update core plugin
  └── 4.3 Update module-template.ts

Phase 5: auth → standard discover single
  ├── 5.1 Move to discover patterns
  ├── 5.2 Remove hardcoded scan
  └── 5.3 Update templates

Phase 6: keyFromProperty in standard templates
  ├── 6.1 Update module-template.ts
  └── 6.2 Update template.ts

Phase 7: Cleanup
  ├── 7.1 emails normalization
  ├── 7.2 appContextEmit docs
  ├── 7.3 registries type cleanup
  ├── 7.4 Tests
  └── 7.5 Regenerate all
```

## End State

After all phases, the system has:

1. **ONE declaration type**: `CategoryDeclaration` drives everything — discovery, Registry augmentation, type emission, placeholder resolution, factory types
2. **NO `moduleRegistries`**: Deleted entirely
3. **NO hardcoded special cases**: `auth` is a standard single, `~fieldTypes` is declarative, views/blocks/components are standard categories
4. **Derived categories**: `listViews`/`formViews` use `derivedFrom` on CategoryDeclaration — still transform-driven at runtime but with proper declarative metadata
5. **ONE Registry augmentation path**: `module-template.ts` reads `registryKey` from `CategoryDeclaration` (and `registryKey` from discover singles)
6. **ONE placeholder resolution path**: `factory-template.ts` reads `placeholder`/`recordPlaceholder` from `CategoryDeclaration`
7. **`keyFromProperty` works everywhere**: Standard templates respect it, not just the custom admin-client generator

Everything follows the same principle. No exceptions. No dual paths. No dead code.
