import type { ExtractModulePropArrOverride } from "#questpie/server/config/codegen-type-utils.js";

import type { Equal, Expect } from "./type-test-utils.js";

type Shared = {
	name: "shared";
	collections: {
		entry: { owner: "shared" };
	};
};

type Left = {
	name: "left";
	modules: readonly [Shared];
	collections: {
		entry: { owner: "left" };
	};
};

type Right = {
	name: "right";
	modules: readonly [Shared];
	collections: {
		rightOnly: { owner: "right" };
	};
};

type DiamondCollections = ExtractModulePropArrOverride<
	readonly [Left, Right],
	"collections"
>;

// Runtime resolves [shared, left, right]. Reaching shared through right must not
// replay it after left and replace left's override.
type _leftOverrideKeepsItsRuntimePosition = Expect<
	Equal<DiamondCollections["entry"]["owner"], "left">
>;
type _rightContributionSurvives = Expect<
	Equal<DiamondCollections["rightOnly"]["owner"], "right">
>;
