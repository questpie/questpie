import { describe, expect, it } from "bun:test";

import { mergeReactiveFieldState } from "#questpie/admin/client/hooks/use-reactive-fields";

describe("reactive field state", () => {
	it("applies server reactive hidden/readOnly/disabled state over visible editable fields", () => {
		expect(
			mergeReactiveFieldState(
				{ hidden: false, readOnly: false, disabled: false },
				{ hidden: true, readOnly: true, disabled: true },
			),
		).toEqual({
			hidden: true,
			readOnly: true,
			disabled: true,
		});
	});

	it("does not let reactive false override static hidden/readOnly/disabled field state", () => {
		expect(
			mergeReactiveFieldState(
				{ hidden: true, readOnly: true, disabled: true },
				{ hidden: false, readOnly: false, disabled: false },
			),
		).toEqual({
			hidden: true,
			readOnly: true,
			disabled: true,
		});
	});
});
