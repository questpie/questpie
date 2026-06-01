import { describe, expect, it } from "bun:test";

import {
	createPreviewFunctions,
	createPreviewTokenVerifier,
	verifyPreviewTokenDirect,
} from "../../src/server/modules/admin/routes/preview.js";

function routeContext(input: unknown, secret = "preview-secret", role = "admin") {
	return {
		input,
		app: { config: { secret } },
		session: { user: { id: "admin_1", role } },
		locale: "en",
		params: {},
		request: new Request("http://localhost"),
	};
}

describe("preview token helpers", () => {
	it("signs and verifies preview tokens with Web Crypto and app config secret", async () => {
		const preview = createPreviewFunctions();
		const { token, expiresAt } = await preview.mintPreviewToken.handler(
			routeContext({ path: "/posts/hello" }) as any,
		);

		expect(token).toContain(".");
		expect(expiresAt).toBeGreaterThan(Date.now());

		const verified = await preview.verifyPreviewToken.handler(
			routeContext({ token }) as any,
		);

		expect(verified).toEqual({ valid: true, path: "/posts/hello" });
		expect(await verifyPreviewTokenDirect(token, "preview-secret")).toEqual({
			path: "/posts/hello",
			exp: expiresAt,
		});
	});

	it("returns null for standalone verification with the wrong secret", async () => {
		const preview = createPreviewFunctions("right-secret");
		const { token } = await preview.mintPreviewToken.handler(
			routeContext({ path: "/draft" }, "ignored") as any,
		);
		const verify = createPreviewTokenVerifier("wrong-secret");

		expect(await verify(token)).toBeNull();
	});

	it("requires admin role to mint preview tokens", async () => {
		const preview = createPreviewFunctions();
		const mintPreviewToken = preview.mintPreviewToken as any;
		const userCtx = routeContext(
			{ path: "/draft" },
			"preview-secret",
			"user",
		);

		expect(await mintPreviewToken.access(userCtx)).toBe(false);
		await expect(mintPreviewToken.handler(userCtx)).rejects.toThrow(
			"Admin session required",
		);
	});
});
