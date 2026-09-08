import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import {
	installQuestpieForTracer,
	installReactForTracer,
} from "../support/beta12-packed-questpie";
import { contextCodec, resources } from "../support/native-query-contract";

test("the source tracer installation runs the native factory with real Query and React peers", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-native-install-"));
	try {
		await installQuestpieForTracer(temporary, "");
		await installReactForTracer(temporary);
		await writeFile(
			join(temporary, "client.ts"),
			renderClientContract(resources, {
				application: "application:native-query-tests",
				clientContractDigest: "1".repeat(64),
				httpContractDigest: "2".repeat(64),
				contextCodec,
			}),
		);
		await writeFile(
			join(temporary, "consumer.ts"),
			`import assert from "node:assert/strict";
import { createQueryAdapter } from "questpie/react-query";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createClient } from "./client";

const cache = new QueryClient();
let calls = 0;
const client = createClient({ baseUrl: "http://127.0.0.1", fetch: async (request) => {
  calls++;
  assert.equal(request.method, "GET");
  assert.equal(new URL(request.url).pathname, "/_questpie/query/tasks.detail");
  return Response.json({ callId: request.headers.get("Questpie-Call-Id"), result: {
    id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131", title: "Installed native consumer",
    updatedAt: "2026-09-08T10:00:00.000Z"
  } }, { headers: { "content-type": "application/json; charset=utf-8" } });
} });
const adapter = createQueryAdapter(client.withContext({ companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" }), cache, { ssr: true });
const options = adapter.queries["tasks.detail"].options({ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" });
function Screen() {
  const query = useQuery(options);
  return createElement("p", null, query.data?.title);
}
try {
  const result = await cache.fetchQuery(options);
  assert.ok(result.updatedAt instanceof Date);
  const html = renderToString(createElement(QueryClientProvider, { client: cache }, createElement(Screen)));
  assert.equal(html, "<p>Installed native consumer</p>");
  assert.equal(calls, 1);
  console.log("NATIVE_SOURCE_INSTALL_PASSED");
} finally {
  await adapter.dispose();
  cache.clear();
}
`,
		);
		const child = Bun.spawn([process.execPath, "consumer.ts"], {
			cwd: temporary,
			env: { ...process.env, TMPDIR: temporary },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 10_000,
		});
		const [exit, out, err] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (exit !== 0)
			throw new Error(`Native source installation failed:\n${out}\n${err}`);
		expect(out.trim()).toBe("NATIVE_SOURCE_INSTALL_PASSED");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 15_000);
