import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { createSimpleI18n } from "../../src/exports/client";

describe("generic client i18n", () => {
	it("translates, interpolates, pluralizes, formats, and detects base-language RTL", () => {
		const i18n = createSimpleI18n({
			locale: "en",
			locales: ["en", "ar-EG"] as const,
			messages: {
				en: {
					greeting: "Hello {{name}}",
					items: { one: "{{count}} item", other: "{{count}} items" },
				},
				"ar-EG": {
					greeting: "مرحبًا {{name}}",
					items: { one: "عنصر واحد", other: "{{count}} عناصر" },
				},
			},
			fallbackLocale: "en",
		});

		expect(i18n.t("greeting", { name: "Ada" })).toBe("Hello Ada");
		expect(i18n.t("items", { count: 2 })).toBe("2 items");
		expect(i18n.formatNumber(1234.5)).toBe(
			new Intl.NumberFormat("en").format(1234.5),
		);
		expect(
			i18n.formatDate(new Date("2026-07-26T12:00:00.000Z"), {
				timeZone: "UTC",
			}),
		).toBe(
			new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(
				new Date("2026-07-26T12:00:00.000Z"),
			),
		);

		i18n.setLocale("ar-EG");
		expect(i18n.t("greeting", { name: "آدا" })).toBe("مرحبًا آدا");
		expect(i18n.isRTL()).toBe(true);
	});

	it("rejects invalid locale and catalog combinations before creating an adapter", () => {
		const create = createSimpleI18n as (options: unknown) => unknown;
		const catalog = { greeting: "Hello" };

		expect(() => create({ locale: "en", locales: [], messages: {} })).toThrow(
			"at least one locale",
		);
		expect(() =>
			create({
				locale: "en",
				locales: ["en", "en"],
				messages: { en: catalog },
			}),
		).toThrow("unique");
		expect(() =>
			create({
				locale: "de",
				locales: ["en"],
				messages: { en: catalog },
			}),
		).toThrow('Initial locale "de"');
		expect(() =>
			create({
				locale: "en",
				locales: ["en"],
				fallbackLocale: "de",
				messages: { en: catalog },
			}),
		).toThrow('Fallback locale "de"');
		expect(() =>
			create({
				locale: "en",
				locales: ["en", "sk"],
				messages: { en: catalog },
			}),
		).toThrow('Missing catalog for locale "sk"');
		expect(() =>
			create({
				locale: "en",
				locales: ["en"],
				messages: { en: catalog, sk: catalog },
			}),
		).toThrow('Unexpected catalog for locale "sk"');
		expect(() =>
			create({
				locale: "en",
				locales: ["en", "sk"],
				messages: {
					en: { greeting: "Hello", save: "Save" },
					sk: { greeting: "Ahoj" },
				},
			}),
		).toThrow('Catalog keys for locale "sk"');

		const i18n = create({
			locale: "en",
			locales: ["en"],
			messages: { en: catalog },
		}) as { setLocale(locale: string): void };
		expect(() => i18n.setLocale("sk")).toThrow('Locale "sk"');
	});

	it("reuses Intl formatters while keeping each adapter cache bounded", () => {
		const OriginalNumberFormat = Intl.NumberFormat;
		let constructions = 0;
		class CountingNumberFormat {
			constructor(
				_locale?: string | readonly string[],
				_options?: Intl.NumberFormatOptions,
			) {
				constructions++;
			}

			format(value: number): string {
				return String(value);
			}
		}
		Object.defineProperty(Intl, "NumberFormat", {
			configurable: true,
			value: CountingNumberFormat,
			writable: true,
		});

		try {
			const i18n = createSimpleI18n({
				locale: "en",
				locales: ["en"] as const,
				messages: { en: { greeting: "Hello" } },
			});
			const firstOptions = { cacheKey: 0 } as Intl.NumberFormatOptions;
			i18n.formatNumber(1, firstOptions);
			i18n.formatNumber(2, firstOptions);
			expect(constructions).toBe(1);

			for (let index = 1; index <= 32; index++) {
				i18n.formatNumber(index, {
					cacheKey: index,
				} as Intl.NumberFormatOptions);
			}
			i18n.formatNumber(3, firstOptions);
			expect(constructions).toBe(34);
		} finally {
			Object.defineProperty(Intl, "NumberFormat", {
				configurable: true,
				value: OriginalNumberFormat,
				writable: true,
			});
		}
	});

	it("keeps the universal client entry free of React and Admin imports", async () => {
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "../../src/exports/client.ts")],
			packages: "external",
			target: "browser",
			write: false,
		});
		expect(build.success).toBe(true);
		const output = await build.outputs[0]!.text();
		expect(output).not.toMatch(/from\s+["']react["']/);
		expect(output).not.toContain("@questpie/admin");
	});
});
