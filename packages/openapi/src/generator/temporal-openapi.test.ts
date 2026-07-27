import { describe, expect, test } from "bun:test";

import { collection } from "questpie";

import { generateOpenApiSpec } from "./index.js";

describe("OpenAPI temporal contract", () => {
	test("describes instants as RFC 3339 strings and dates as date-only strings", async () => {
		const events = collection("events").fields(({ f }) => ({
			startsAt: f.datetime({ withTimezone: true, precision: 3 }).required(),
			dateOnly: f.date().required(),
			checkpoints: f.datetime().array().minItems(2).maxItems(4),
			window: f.object({
				startsAt: f.datetime(),
			}),
			localDate: f.date().localized(),
			computedAt: f.datetime().inputFalse(),
			secretDate: f.date().outputFalse(),
		}));
		const app = {
			getCollections: () => ({ events }),
			getGlobals: () => ({}),
		} as any;

		const spec = await generateOpenApiSpec(app);
		const insert = spec.components.schemas.EventsInsert as any;
		const document = spec.components.schemas.EventsDocument as any;

		expect(insert.properties.startsAt).toEqual({
			type: "string",
			format: "date-time",
		});
		expect(insert.properties.dateOnly).toEqual({
			type: "string",
			format: "date",
		});
		expect(document.allOf[1].properties.startsAt).toEqual({
			type: "string",
			format: "date-time",
		});
		expect(document.allOf[1].properties.dateOnly).toEqual({
			type: "string",
			format: "date",
		});
		expect(insert.properties.checkpoints).toEqual({
			type: ["array", "null"],
			items: { type: "string", format: "date-time" },
			minItems: 2,
			maxItems: 4,
		});
		const optionalWindow = insert.properties.window.anyOf.find(
			(branch: any) => branch.properties,
		);
		expect(optionalWindow.properties.startsAt).toEqual({
			type: ["string", "null"],
			format: "date-time",
		});
		expect(insert.properties.localDate).toEqual({
			type: ["string", "null"],
			format: "date",
		});
		expect(insert.properties.secretDate).toEqual({
			type: ["string", "null"],
			format: "date",
			writeOnly: true,
		});
		expect(insert.properties.computedAt).toBeUndefined();
		expect(document.allOf[1].properties.computedAt).toEqual({
			type: ["string", "null"],
			format: "date-time",
			readOnly: true,
		});
		expect(document.allOf[1].properties.secretDate).toBeUndefined();
	});
});
