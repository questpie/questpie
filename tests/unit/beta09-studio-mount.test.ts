import { expect, test } from "bun:test";

import {
	studioAssetPath,
	studioBundleResponse,
} from "../../packages/runtime/src/application/studio-mount";

/**
 * `docs/v4/beta1-build-spec.md:29` names `apps/studio/` a "minimal same-origin
 * operational projection". Same-origin means the application serves it, and
 * `app.fetch` served exactly one path — the Operation wire — returning
 * NOT_FOUND for everything else. That was an absence, not a prohibition:
 * ADR-0014 says `createApp()` exposes `fetch`, and says nothing about fetch
 * serving one path only.
 *
 * The mount is deliberately a read-only asset surface. It carries no Operation,
 * no durable read, and no application data, so it raises no disclosure question
 * of its own — what Studio may see is decided by what it can call, not by how
 * its bytes arrive.
 */
test("the Studio bundle answers a same-origin GET", async () => {
	const response = await studioBundleResponse(
		new Request(`https://app.example${studioAssetPath}`),
	);
	expect(response).not.toBeNull();
	expect(response!.status).toBe(200);
	expect(response!.headers.get("content-type")).toContain("text/html");
	const body = await response!.text();
	expect(body).toContain("<!doctype html>");
});

test("the mount declines every path that is not its own", async () => {
	for (const path of ["/", "/_questpie/operation", "/_questpie/studio/../x"]) {
		const response = await studioBundleResponse(
			new Request(`https://app.example${path}`),
		);
		expect(response).toBeNull();
	}
});

test("the mount serves reads only", async () => {
	const response = await studioBundleResponse(
		new Request(`https://app.example${studioAssetPath}`, { method: "POST" }),
	);
	expect(response).not.toBeNull();
	expect(response!.status).toBe(405);
});
