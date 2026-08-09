import type {
	ExtractModulePropArrOverride,
	ExtractModulePropOverride,
} from "questpie/types";

import type { CodegenResolvedModulePropArr } from "#questpie/server/config/codegen-type-utils.js";

import type { Equal, Expect } from "./type-test-utils.js";

type Shared = {
	name: "shared";
	collections: {
		entry: { owner: "shared" };
	};
	globals: {
		settings: { owner: "shared" };
	};
	jobs: {
		digest: { owner: "shared" };
	};
};

type Left = {
	name: "left";
	modules: readonly [Shared];
	collections: {
		entry: { owner: "left" };
	};
	globals: {
		settings: { owner: "left" };
	};
	jobs: {
		digest: { owner: "left" };
	};
};

type Right = {
	name: "right";
	modules: readonly [Shared];
	collections: {
		rightOnly: { owner: "right" };
	};
};

type DiamondCollections = CodegenResolvedModulePropArr<
	readonly [Left, Right],
	"collections"
>;
type DiamondGlobals = CodegenResolvedModulePropArr<
	readonly [Left, Right],
	"globals"
>;
type DiamondJobs = CodegenResolvedModulePropArr<readonly [Left, Right], "jobs">;

// Runtime resolves [shared, left, right]. Reaching shared through right must not
// replay it after left and replace left's override.
type _leftOverrideKeepsItsRuntimePosition = Expect<
	Equal<DiamondCollections["entry"]["owner"], "left">
>;
type _rightContributionSurvives = Expect<
	Equal<DiamondCollections["rightOnly"]["owner"], "right">
>;
type _globalDependentOverrideKeepsItsRuntimePosition = Expect<
	Equal<DiamondGlobals["settings"]["owner"], "left">
>;
type _otherCategoryUsesTheSameOrderedFold = Expect<
	Equal<DiamondJobs["digest"]["owner"], "left">
>;

type WidenedNameModule = {
	name: string;
	globals: { settings: { owner: "widened" } };
};

// The internal fold is deliberately defined only for generated/const module
// graphs. A widened name must not fall back to structural equality and pretend
// that TypeScript can observe JavaScript object identity.
type _widenedNameDoesNotClaimIdentitySemantics = Expect<
	Equal<
		CodegenResolvedModulePropArr<readonly [WidenedNameModule], "globals">,
		never
	>
>;

type LegacyNested = {
	name: "legacy-nested";
	globals: { nested: { owner: "nested" } };
};
type LegacyOuter = {
	name: "legacy-outer";
	modules: readonly [LegacyNested];
	globals: { outer: { owner: "outer" } };
};

// Patch compatibility: both v3.26.1 public imports remain available with their
// original recursive result shape. New codegen does not call these helpers.
type LegacySingle = ExtractModulePropOverride<LegacyOuter, "globals">;
type LegacyTuple = ExtractModulePropArrOverride<
	readonly [LegacyOuter],
	"globals"
>;
type _legacySingleImportCompiles = Expect<
	Equal<keyof LegacySingle, "nested" | "outer">
>;
type _legacyTupleImportCompiles = Expect<
	Equal<keyof LegacyTuple, "nested" | "outer">
>;
