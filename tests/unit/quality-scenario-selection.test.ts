import { describe, expect, test } from "bun:test";

import {
	parseScenarioFilter,
	selectScenarioIds,
} from "../../scripts/scenario-filter";

describe("quality lane scenario selection", () => {
	test("keeps the complete registered lane when no scenario is requested", () => {
		expect(
			selectScenarioIds(
				["beta05-runtime-client", "beta06-mutation", "beta060-decoy"],
				undefined,
			),
		).toEqual(["beta05-runtime-client", "beta06-mutation", "beta060-decoy"]);
	});

	test("selects only the exact registered scenario namespace", () => {
		expect(
			selectScenarioIds(
				["beta06", "beta06-mutation", "beta060-decoy", "beta06ish"],
				"beta06",
			),
		).toEqual(["beta06", "beta06-mutation"]);
	});

	test("fails closed for an unknown scenario", () => {
		expect(() =>
			selectScenarioIds(["beta05-runtime-client"], "beta06"),
		).toThrow('unknown scenario "beta06"');
	});

	test("requires one well-formed --scenario value", () => {
		expect(parseScenarioFilter(["--scenario", "beta06"])).toBe("beta06");
		expect(() => parseScenarioFilter(["--scenario"])).toThrow(
			"--scenario requires a value",
		);
		expect(() =>
			parseScenarioFilter(["--scenario", "beta05", "--scenario", "beta06"]),
		).toThrow("--scenario may be provided only once");
		expect(() => parseScenarioFilter(["--scenario", "../beta06"])).toThrow(
			"invalid --scenario value",
		);
	});
});
