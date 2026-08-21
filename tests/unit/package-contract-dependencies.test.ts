import { expect, test } from "bun:test";

import {
	embeddedProductionDependencies,
	validateEmbeddedProductionDependencies,
} from "../../scripts/package-contract-dependencies";

test("refuses a missing or mismatched embedded production dependency", () => {
	const embedded = embeddedProductionDependencies([
		{
			name: "@questpie/runtime",
			dependencies: { pg: "8.22.0", questpie: "workspace:*" },
		},
		{
			name: "@questpie/compiler",
			dependencies: { typescript: "6.0.2", questpie: "workspace:*" },
		},
	]);

	expect(embedded).toEqual(
		new Map([
			["pg", "8.22.0"],
			["typescript", "6.0.2"],
		]),
	);
	expect(() =>
		validateEmbeddedProductionDependencies({ typescript: "6.0.2" }, embedded),
	).toThrow("questpie: embedded production dependency pg@8.22.0 is missing");
	expect(() =>
		validateEmbeddedProductionDependencies(
			{ pg: "^8.22.0", typescript: "6.0.2" },
			embedded,
		),
	).toThrow(
		"questpie: embedded production dependency pg requires 8.22.0, found ^8.22.0",
	);
});

test("refuses conflicting private dependency specifications", () => {
	expect(() =>
		embeddedProductionDependencies([
			{ name: "@questpie/runtime", dependencies: { pg: "8.22.0" } },
			{ name: "@questpie/compiler", dependencies: { pg: "8.21.0" } },
		]),
	).toThrow(
		"embedded production dependency pg has conflicting specifications 8.22.0 and 8.21.0",
	);
});
