import { describe, expect, it } from "vitest";

import { classifyRunError } from "../lib/error-classifier";

describe("classifyRunError", () => {
	it("classifies retry-relevant worker/runtime failures", () => {
		expect(classifyRunError("lease expired while worker was busy")).toBe(
			"infra",
		);
		expect(classifyRunError("request timed out after 60s")).toBe("timeout");
		expect(classifyRunError("429 too many requests")).toBe("rate_limit");
	});

	it("keeps business and unknown failures separate", () => {
		expect(classifyRunError("validation failed for requested change")).toBe(
			"business",
		);
		expect(classifyRunError("something odd happened")).toBe("unknown");
	});
});
