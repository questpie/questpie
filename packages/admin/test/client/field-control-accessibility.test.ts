import { describe, expect, it } from "bun:test";

import { composeFieldAriaDescribedBy } from "../../src/client/components/ui/field";

describe("composeFieldAriaDescribedBy", () => {
	it("keeps an explicit aria-describedby value authoritative", () => {
		expect(
			composeFieldAriaDescribedBy("custom-help", {
				descriptionId: "field-desc",
				errorId: "field-error",
				hasDescription: true,
				hasError: true,
			}),
		).toBe("custom-help");
	});

	it("links an error before the supporting description", () => {
		expect(
			composeFieldAriaDescribedBy(undefined, {
				descriptionId: "field-desc",
				errorId: "field-error",
				hasDescription: true,
				hasError: true,
			}),
		).toBe("field-error field-desc");
	});

	it("omits ids for content that is not mounted", () => {
		expect(
			composeFieldAriaDescribedBy(undefined, {
				descriptionId: "field-desc",
				errorId: "field-error",
				hasDescription: false,
				hasError: false,
			}),
		).toBeUndefined();
	});

	it("links whichever supporting content is mounted", () => {
		expect(
			composeFieldAriaDescribedBy(undefined, {
				descriptionId: "field-desc",
				errorId: "field-error",
				hasDescription: true,
				hasError: false,
			}),
		).toBe("field-desc");
		expect(
			composeFieldAriaDescribedBy(undefined, {
				descriptionId: "field-desc",
				errorId: "field-error",
				hasDescription: false,
				hasError: true,
			}),
		).toBe("field-error");
	});

	it("does not invent ids outside a Field", () => {
		expect(composeFieldAriaDescribedBy(undefined, null)).toBeUndefined();
	});
});
