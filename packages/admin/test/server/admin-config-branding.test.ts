/**
 * Branding DTO schema tests
 *
 * Locks the new typed surface for `branding` in the admin-config DTO.
 * The previous `z.record(z.string(), z.any())` schema accepted anything;
 * these tests pin down the new shape so a regression to a permissive
 * schema (or a forgotten field) trips here.
 */

import { describe, expect, it } from "bun:test";

import { adminConfigDTOSchema } from "#questpie/admin/server/modules/admin/dto/admin-config.dto";

const branding = (b: unknown) =>
	adminConfigDTOSchema.safeParse({ branding: b });

describe("admin-config DTO — branding", () => {
	it("accepts a minimal branding (name only, plain string)", () => {
		const result = branding({ name: "Admin" });
		expect(result.success).toBe(true);
	});

	it("accepts a name as a locale map", () => {
		const result = branding({ name: { en: "Admin", sk: "Administrácia" } });
		expect(result.success).toBe(true);
	});

	it("accepts logo as a URL string", () => {
		const result = branding({ name: "X", logo: "/logo.png" });
		expect(result.success).toBe(true);
	});

	it("accepts logo as { src, srcDark, alt, width, height }", () => {
		const result = branding({
			name: "X",
			logo: {
				src: "/logo-light.svg",
				srcDark: "/logo-dark.svg",
				alt: "Acme",
				width: 64,
				height: 64,
			},
		});
		expect(result.success).toBe(true);
	});

	it("accepts logo as a ComponentReference", () => {
		const result = branding({
			name: "X",
			logo: { type: "icon", props: { name: "ph:scissors" } },
		});
		expect(result.success).toBe(true);
	});

	it("accepts a full branding payload (name + logo + tagline + favicon)", () => {
		const result = branding({
			name: { en: "Acme", sk: "Akmé" },
			logo: { src: "/logo.svg" },
			tagline: { en: "Run your shop" },
			favicon: "/favicon.ico",
		});
		expect(result.success).toBe(true);
	});

	it("rejects favicon as a non-string", () => {
		const result = branding({ name: "X", favicon: 123 });
		expect(result.success).toBe(false);
	});

	it("rejects logo as an unrelated primitive", () => {
		const result = branding({ name: "X", logo: 42 });
		expect(result.success).toBe(false);
	});

	it("treats branding as optional (empty config parses)", () => {
		const result = adminConfigDTOSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("rejects logo object missing required src", () => {
		const result = branding({ name: "X", logo: { srcDark: "/dark.svg" } });
		expect(result.success).toBe(false);
	});
});
