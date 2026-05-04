import { describe, expect, it } from "bun:test";

import { field } from "../../src/client/builder/field/field";
import { buildFieldDefinitionsFromSchema } from "../../src/client/utils/build-field-definitions-from-schema";

function TestField() {
	return null;
}

const registry = {
	text: field("text", { component: TestField }),
};

describe("buildFieldDefinitionsFromSchema", () => {
	it("applies current field-level admin meta shape", () => {
		const fields = buildFieldDefinitionsFromSchema(
			{
				fields: {
					name: {
						metadata: {
							type: "text",
							label: "Name",
							required: false,
							localized: false,
							meta: {
								placeholder: "Enter name",
								autoComplete: "name",
							},
						},
					},
				},
				relations: {},
			} as any,
			registry,
		);

		expect(fields.name?.["~options"].placeholder).toBe("Enter name");
		expect(fields.name?.["~options"].autoComplete).toBe("name");
	});

	it("keeps supporting legacy meta.admin shape", () => {
		const fields = buildFieldDefinitionsFromSchema(
			{
				fields: {
					name: {
						metadata: {
							type: "text",
							label: "Name",
							required: false,
							localized: false,
							meta: {
								admin: {
									placeholder: "Legacy name",
								},
							},
						},
					},
				},
				relations: {},
			} as any,
			registry,
		);

		expect(fields.name?.["~options"].placeholder).toBe("Legacy name");
	});
});
