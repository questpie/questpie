import { describe, expect, it } from "bun:test";

import { findRuntimeConsoleCalls } from "./runtime-console-gate.js";

describe("F09 runtime console gate", () => {
	it("permits only documented console boundaries", () => {
		expect(findRuntimeConsoleCalls()).toEqual([]);
	});
});
