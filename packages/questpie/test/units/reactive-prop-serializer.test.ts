/**
 * Unit tests for the reactive prop serializer used by admin form-layout
 * introspection.
 *
 * Functions in `props.<key>` get replaced with a `ReactivePropPlaceholder`
 * carrying the watched dep list — the actual handler stays on the server
 * and is evaluated on demand by `/admin/reactive` (`type: "prop"`).
 * Static values pass through unchanged.
 */

import { describe, expect, it } from "bun:test";

import {
	isReactivePropPlaceholder,
	serializeFormLayoutProps,
	serializeReactivePropsRecord,
	serializeReactivePropValue,
} from "../../src/exports/index.js";

describe("serializeReactivePropValue", () => {
	it("passes through static JSON values unchanged (referentially)", () => {
		const arr = [1, 2, 3];
		expect(serializeReactivePropValue(arr)).toBe(arr);
		const obj = { role: "admin" };
		expect(serializeReactivePropValue(obj)).toBe(obj);
		expect(serializeReactivePropValue("plain")).toBe("plain");
		expect(serializeReactivePropValue(42)).toBe(42);
		expect(serializeReactivePropValue(null)).toBe(null);
	});

	it("returns undefined for undefined", () => {
		expect(serializeReactivePropValue(undefined)).toBeUndefined();
	});

	it("replaces a function value with a ReactivePropPlaceholder, deps inferred", () => {
		const fn = ({ data }: any) => ({ team: data.team, status: data.status });
		const result = serializeReactivePropValue(fn);
		expect(isReactivePropPlaceholder(result)).toBe(true);
		const placeholder = result as { "~reactive": string; watch: string[] };
		expect(placeholder["~reactive"]).toBe("prop");
		// trackDependencies should pick up at least these
		expect(placeholder.watch).toContain("team");
		expect(placeholder.watch).toContain("status");
	});

	it("replaces a { handler, deps } config and uses explicit deps", () => {
		const cfg = {
			handler: ({ data }: any) => ({ id: data.somewhere }),
			deps: ["explicit.path"],
		};
		const result = serializeReactivePropValue(cfg);
		expect(isReactivePropPlaceholder(result)).toBe(true);
		expect((result as { watch: string[] }).watch).toEqual(["explicit.path"]);
	});

	it("propagates debounce from a config object", () => {
		const cfg = {
			handler: () => ({}),
			deps: ["x"],
			debounce: 250,
		};
		const result = serializeReactivePropValue(cfg) as {
			watch: string[];
			debounce?: number;
		};
		expect(result.debounce).toBe(250);
	});
});

describe("isReactivePropPlaceholder", () => {
	it("returns false for static values", () => {
		expect(isReactivePropPlaceholder({ role: "admin" })).toBe(false);
		expect(isReactivePropPlaceholder([])).toBe(false);
		expect(isReactivePropPlaceholder(null)).toBe(false);
		expect(isReactivePropPlaceholder(undefined)).toBe(false);
		expect(isReactivePropPlaceholder("filter")).toBe(false);
	});

	it("returns true only for the exact `~reactive: prop` discriminator", () => {
		expect(
			isReactivePropPlaceholder({ "~reactive": "prop", watch: [] }),
		).toBe(true);
		// Wrong discriminator value
		expect(
			isReactivePropPlaceholder({ "~reactive": "compute", watch: [] }),
		).toBe(false);
		// Looks similar but misses discriminator
		expect(isReactivePropPlaceholder({ watch: ["x"] })).toBe(false);
	});
});

describe("serializeReactivePropsRecord", () => {
	it("returns undefined for empty / undefined input", () => {
		expect(serializeReactivePropsRecord(undefined)).toBeUndefined();
		expect(serializeReactivePropsRecord({})).toBeUndefined();
	});

	it("mixes static and dynamic entries side by side", () => {
		const out = serializeReactivePropsRecord({
			staticFilter: { role: "admin" },
			dynamicFilter: ({ data }: any) => ({ team: data.team }),
		})!;
		expect(out.staticFilter).toEqual({ role: "admin" });
		expect(isReactivePropPlaceholder(out.dynamicFilter)).toBe(true);
	});
});

describe("serializeFormLayoutProps", () => {
	it("walks fields, sections, tabs, and sidebar arrays", () => {
		const layout = [
			{
				field: "counselorId",
				props: { filter: ({ data }: any) => ({ team: data.team }) },
			},
			{
				type: "section",
				fields: [
					{
						field: "authorId",
						props: { filter: { role: "admin" } },
					},
				],
			},
			{
				type: "tabs",
				tabs: [
					{
						fields: [
							{
								field: "x",
								props: { foo: ({ data }: any) => data.bar },
							},
						],
					},
				],
			},
		];

		const out = serializeFormLayoutProps(layout) as any[];

		// 1st item — function-valued filter became placeholder
		expect(isReactivePropPlaceholder(out[0].props.filter)).toBe(true);
		expect(out[0].props.filter.watch).toContain("team");

		// section nested
		const sectionField = out[1].fields[0];
		expect(sectionField.props.filter).toEqual({ role: "admin" });

		// tabs nested
		const tabField = out[2].tabs[0].fields[0];
		expect(isReactivePropPlaceholder(tabField.props.foo)).toBe(true);
		expect(tabField.props.foo.watch).toContain("bar");
	});

	it("does not mutate the input layout", () => {
		const fn = ({ data }: any) => data.x;
		const input: any[] = [{ field: "foo", props: { filter: fn } }];
		const inputBefore = JSON.stringify(input, (_, v) =>
			typeof v === "function" ? "<<fn>>" : v,
		);
		serializeFormLayoutProps(input);
		expect(input[0].props.filter).toBe(fn);
		const inputAfter = JSON.stringify(input, (_, v) =>
			typeof v === "function" ? "<<fn>>" : v,
		);
		expect(inputBefore).toBe(inputAfter);
	});

	it("returns non-layout values unchanged", () => {
		expect(serializeFormLayoutProps(null)).toBe(null);
		expect(serializeFormLayoutProps("foo" as any)).toBe("foo" as any);
		expect(serializeFormLayoutProps(42 as any)).toBe(42 as any);
	});
});
