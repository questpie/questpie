import assert from "node:assert/strict";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");

async function run(command: string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, TMPDIR: cwd },
		stdout: "pipe",
		stderr: "pipe",
		timeout: 90_000,
	});
	const [exit, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exit !== 0)
		throw new Error(
			`Packed native consumer failed (${command[1]}):\n${stdout}${stderr}`,
		);
	return stdout;
}

/** Uses an existing archive only. The caller owns temporaryRoot and its cleanup. */
export async function verifyPackedNativeQuery(
	coreTarball: string,
	temporaryRoot: string,
	mode: "runtime" | "browser",
): Promise<void> {
	assert.ok(
		mode === "runtime" || mode === "browser",
		"Packed proof requires an explicit execution mode",
	);
	const original = join(temporaryRoot, "original");
	await mkdir(original, { recursive: true });
	await mkdir(join(original, "packages"));
	const fixture = join(repository, "fixtures/archive");
	await cp(join(fixture, "src"), join(original, "src"), { recursive: true });
	// Add an explicit public structural Query to the copied Archive application.
	// Its existing handler Query remains unchanged and does not claim continuation.
	await writeFile(join(original, "src/record-native-page.ts"), pageSource);
	await cp(join(fixture, "questpie.json"), join(original, "questpie.json"));
	const metadata = JSON.parse(
		await readFile(join(fixture, "package.json"), "utf8"),
	);
	const packageJson = {
		name: "native-packed-consumer",
		private: true,
		type: "module",
		imports: metadata.imports,
		dependencies: { questpie: `file:${resolve(coreTarball)}` } as Record<
			string,
			string
		>,
	};
	await writeFile(join(original, "package.json"), JSON.stringify(packageJson));
	await writeFile(
		join(original, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noUncheckedIndexedAccess: true,
				noEmit: true,
				skipLibCheck: true,
				module: "ESNext",
				moduleResolution: "Bundler",
				target: "ES2024",
				jsx: "react-jsx",
				allowImportingTsExtensions: true,
				types: ["bun"],
			},
			include: ["src/**/*.ts", "*.tsx", "*.ts"],
		}),
	);
	await run(["bun", "install", "--ignore-scripts", "--omit", "peer"], original);
	await writeFile(join(original, "core.ts"), coreSource);
	await run(["bun", "core.ts"], original);
	await run([join(original, "node_modules/.bin/questpie"), "build"], original);
	assert.ok(
		await Bun.file(
			join(original, ".questpie/generated/internal/application.js"),
		).exists(),
		"Packed CLI emitted no Runtime application",
	);
	await writeFile(
		join(original, "core-browser.ts"),
		'export { createClient } from "#questpie/client";\n',
	);
	await writeFile(join(original, "core-build.ts"), coreBuildSource);
	await run(["bun", "core-build.ts"], original);

	const root = JSON.parse(
		await readFile(join(repository, "package.json"), "utf8"),
	);
	for (const name of [
		"react",
		"react-dom",
		"@tanstack/react-query",
		"@types/react",
		"@types/react-dom",
	])
		packageJson.dependencies[name] = root.devDependencies[name];
	await writeFile(join(original, "package.json"), JSON.stringify(packageJson));
	await run(["bun", "install", "--ignore-scripts"], original);
	await writeFile(join(original, "native.tsx"), nativeSource);
	await writeFile(join(original, "consumer.tsx"), consumerSource);
	await writeFile(join(original, "browser.tsx"), browserSource);
	await writeFile(join(original, "browser-host.ts"), browserHostSource);
	await writeFile(join(original, "native.types.tsx"), typesSource);
	await run(
		["bun", "node_modules/typescript/bin/tsc", "--pretty", "false"],
		original,
	);
	assert.match(
		await run(["bun", "consumer.tsx"], original),
		/NATIVE_PACKED_PASSED/,
	);
	const relocated = join(temporaryRoot, "relocated");
	await rename(original, relocated);
	await run(
		["bun", "node_modules/typescript/bin/tsc", "--pretty", "false"],
		relocated,
	);
	assert.match(
		await run(["bun", "consumer.tsx"], relocated),
		/NATIVE_PACKED_PASSED/,
	);
	if (mode === "browser")
		assert.match(
			await run(["bun", "browser-host.ts"], relocated),
			/NATIVE_PACKED_BROWSER_PASSED/,
		);
	// Importing the factory is deliberately permitted without peers: its native
	// QueryClient dependency is type-only. Retired public imports must still break.
	await run(
		[
			"bun",
			"-e",
			`let retired = false; try { await import("questpie/react"); } catch { retired = true; } if (!retired) throw new Error("Retired questpie/react remains importable");`,
		],
		relocated,
	);
	const missingReact = join(temporaryRoot, "missing-react");
	await mkdir(missingReact);
	await writeFile(
		join(missingReact, "package.json"),
		JSON.stringify({
			private: true,
			type: "module",
			dependencies: {
				"@tanstack/react-query": root.devDependencies["@tanstack/react-query"],
			},
		}),
	);
	await run(
		["bun", "install", "--ignore-scripts", "--omit", "peer"],
		missingReact,
	);
	await run(
		[
			"bun",
			"-e",
			`import assert from "node:assert/strict"; await assert.rejects(import("react"), /Cannot find|MODULE_NOT_FOUND/); await assert.rejects(import("@tanstack/react-query"), /Cannot find|MODULE_NOT_FOUND/);`,
		],
		missingReact,
	);
	const unsupported = join(temporaryRoot, "unsupported-peers");
	await mkdir(unsupported);
	await writeFile(
		join(unsupported, "package.json"),
		JSON.stringify({
			private: true,
			type: "module",
			dependencies: {
				questpie: `file:${resolve(coreTarball)}`,
				react: "18.3.1",
				"@tanstack/react-query": "5.0.0",
			},
		}),
	);
	await run(["bun", "install", "--ignore-scripts"], unsupported);
	await writeFile(join(unsupported, "verify.ts"), unsupportedPeersSource);
	await run(["bun", "verify.ts"], unsupported);
}

const unsupportedPeersSource = `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { version } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";
const core = JSON.parse(await readFile("node_modules/questpie/package.json", "utf8"));
const native = JSON.parse(await readFile("node_modules/@tanstack/react-query/package.json", "utf8"));
assert.equal(version, "18.3.1");
assert.equal(native.version, "5.0.0");
assert.equal(Bun.semver.satisfies(version, core.peerDependencies.react), false);
assert.equal(Bun.semver.satisfies(native.version, core.peerDependencies["@tanstack/react-query"]), false);
// Unsupported means outside the declared support range, not a manufactured
// runtime version guard. These real older packages and the factory still import.
assert.equal(typeof createQueryAdapter, "function");
const cache = new QueryClient();
cache.setQueryData(["real-older-peer"], 1);
assert.equal(cache.getQueryData(["real-older-peer"]), 1);
cache.clear();
`;

const pageSource = `import { codec } from "questpie";
import { defineQuery } from "#questpie/app";
import { records } from "./records";
export const nativePage = defineQuery({
  name: "records.nativePage", network: true,
  query: records.list({
    parameters: { archiveCode: codec.text({ maxLength: 32 }), first: codec.integer({ minimum: 1, maximum: 100 }), after: codec.nullable(codec.cursor()) },
    where: ({ row, parameters }) => row.archiveCode.equal(parameters.archiveCode),
    orderBy: { archiveCode: "asc", catalogueNumber: "desc" },
    select: { archiveCode: true, catalogueNumber: true, visibility: true, title: true, body: true, createdAt: true },
    page: ({ parameters }) => ({ first: parameters.first, after: parameters.after }),
  }),
});
`;

const coreSource = `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { codec } from "questpie";
import { createQueryAdapter } from "questpie/react-query";
assert.equal(typeof codec.object, "function");
assert.equal(typeof createQueryAdapter, "function");
const require = createRequire(import.meta.url);
for (const peer of ["react", "react-dom", "@tanstack/react-query", "@noble/hashes", "questpie-opentelemetry"]) {
  assert.throws(() => require.resolve(peer), /Cannot find|MODULE_NOT_FOUND/, peer + " leaked into core");
}
await assert.rejects(import("@tanstack/react-query"), /Cannot find|MODULE_NOT_FOUND/);
`;

const coreBuildSource = `import assert from "node:assert/strict";
const result = await Bun.build({ entrypoints: ["./core-browser.ts"], target: "browser", outdir: "./core-dist", plugins: [{
  name: "no-optional-core-dependencies", setup(build) {
    build.onResolve({ filter: /^(react(?:-dom)?(?:\\/|$)|@tanstack\\/|@noble\\/|@opentelemetry\\/|questpie-opentelemetry)/ }, ({ path }) => {
      throw new Error("Core client imports optional dependency " + path);
    });
  },
}] });
assert.equal(result.success, true, result.logs.join("\\n"));
`;

const nativeSource = `import { QueryClient, QueryClientProvider, useQuery, useSuspenseQuery, useInfiniteQuery, useSuspenseInfiniteQuery, useMutation } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";
import { createClient, type GeneratedClientScope } from "#questpie/client";

export const input = { archiveCode: "public", catalogueNumber: "2", visibility: "public", title: "New record", body: "Deposit content" };
const createdAt = new Date("2026-09-09T10:00:00.000Z");
export function reply(request: Request) {
  const url = new URL(request.url);
  const callId = decodeURIComponent(request.headers.get(request.method === "POST" ? "Idempotency-Key" : "Questpie-Call-Id")!);
  if (url.pathname === "/_questpie/mutation/record.deposit") {
    const result = { archiveCode: "public", catalogueNumber: "2", createdAt } satisfies Awaited<ReturnType<GeneratedClientScope["mutations"]["record.deposit"]>>;
    return Response.json({ callId, result }, { headers: { "content-type": "application/json; charset=utf-8" } });
  }
  if (!["/_questpie/query/records.page", "/_questpie/query/records.nativePage"].includes(url.pathname)) throw new Error("Unexpected operation " + url.pathname);
  const second = url.searchParams.get("after") !== "~null";
  const result = {
    nodes: [{ archiveCode: "public", catalogueNumber: second ? "2" : "1", visibility: "public", title: second ? "Second record" : "First record", body: "Disclosed body", createdAt }],
    pageInfo: { endCursor: second ? "cursor-2" : "cursor-1", hasNextPage: !second },
  } satisfies Awaited<ReturnType<GeneratedClientScope["queries"]["records.page"]>> & Awaited<ReturnType<GeneratedClientScope["queries"]["records.nativePage"]>>;
  return Response.json({ callId, result }, { headers: { "content-type": "application/json; charset=utf-8" } });
}

export function createOwner(baseUrl: string, transport?: typeof fetch) {
  const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const scope = createClient({ baseUrl, fetch: transport }).withContext({ archiveCode: "public" });
  // This package control exercises HTTP-backed native options. Real live and
  // Start hydration lifetimes are covered by the separately owned browser tracers.
  const api = createQueryAdapter(scope, cache, { ssr: true });
  const finite = api.queries["records.page"].options({ archiveCode: "public", first: 1, after: null });
  const infinite = api.queries["records.nativePage"].infiniteOptions({ archiveCode: "public", first: 1 });
  return { cache, api, finite, infinite };
}
export type Owner = ReturnType<typeof createOwner>;
export function Screen({ owner, record }: { owner: Owner; record: (event: string) => void }) {
  const finite = useQuery(owner.finite);
  const suspense = useSuspenseQuery(owner.finite);
  const infinite = useInfiniteQuery(owner.infinite);
  const suspenseInfinite = useSuspenseInfiniteQuery(owner.infinite);
  const deposit = useMutation({ ...owner.api.mutations["record.deposit"].options(),
    onMutate: (variables) => { record("mutate:" + variables.title); return { local: "intent" }; },
    onSuccess: (result, _variables, context) => { if (!(result.createdAt instanceof Date) || context?.local !== "intent") throw new Error("Native callback contract lost"); record("success"); },
    onSettled: () => record("settled"),
  });
  return <section>
    <p id="finite">{finite.data?.nodes[0]?.title}</p>
    <p id="suspense">{suspense.data.nodes[0]?.createdAt instanceof Date ? "decoded" : "raw"}</p>
    <p id="pages">{infinite.data?.pages.map((page) => page.nodes[0]?.title).join(",")}</p>
    <p id="suspense-pages">{suspenseInfinite.data.pages.length}</p>
    <p id="mutation">{deposit.status}</p>
    <button id="next" onClick={() => void infinite.fetchNextPage()}>Next</button>
    <button id="deposit" onClick={() => deposit.mutate(input)}>Deposit</button>
  </section>;
}
export function App({ owner, record }: { owner: Owner; record: (event: string) => void }) {
  return <QueryClientProvider client={owner.cache}><Screen owner={owner} record={record} /></QueryClientProvider>;
}
`;

const consumerSource = `import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MutationObserver } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { App, createOwner, input, reply } from "./native";
for (const name of ["questpie", "react", "react-dom", "@tanstack/react-query"]) {
  assert.ok((await realpath(fileURLToPath(import.meta.resolve(name)))).startsWith(process.cwd() + "/node_modules/"), name + " resolved outside packed consumer");
}
const owner = createOwner("http://127.0.0.1", Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => reply(new Request(input, init)), { preconnect() {} }));
try {
  await owner.cache.fetchQuery(owner.finite).catch((cause) => { throw new Error("Finite packed Query failed", { cause }); });
  await owner.cache.fetchInfiniteQuery(owner.infinite).catch((cause) => { throw new Error("Infinite packed Query failed", { cause }); });
  const html = renderToString(<App owner={owner} record={() => {}} />);
  assert.ok(html.includes("First record"));
  assert.ok(html.includes("decoded"));
  assert.ok(owner.cache.getQueryData(owner.infinite.queryKey)?.pages[0]?.nodes[0]?.createdAt instanceof Date);
  const events: string[] = [];
  const mutation = new MutationObserver(owner.cache, { ...owner.api.mutations["record.deposit"].options(),
    onMutate: () => { events.push("mutate"); return { intent: true }; },
    onSuccess: (result, _input, context) => { assert.ok(result.createdAt instanceof Date); assert.equal(context?.intent, true); events.push("success"); },
    onSettled: () => { events.push("settled"); },
  });
  await mutation.mutate(input);
  assert.deepEqual(events, ["mutate", "success", "settled"]);
  console.log("NATIVE_PACKED_PASSED");
} finally { await owner.api.dispose(); owner.cache.clear(); }
`;

const browserSource = `import { createRoot } from "react-dom/client";
import { App, createOwner } from "./native";
const events: string[] = [];
const owner = createOwner(location.origin);
const root = createRoot(document.getElementById("root")!);
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error("Browser condition did not settle");
}
try {
  await owner.cache.fetchQuery(owner.finite);
  await owner.cache.fetchInfiniteQuery(owner.infinite);
  root.render(<App owner={owner} record={(event) => events.push(event)} />);
  await until(() => document.querySelector("#finite")?.textContent === "First record");
  document.querySelector<HTMLButtonElement>("#next")!.click();
  await until(() => document.querySelector("#pages")?.textContent === "First record,Second record");
  await until(() => document.querySelector("#suspense-pages")?.textContent === "2");
  document.querySelector<HTMLButtonElement>("#deposit")!.click();
  await until(() => document.querySelector("#mutation")?.textContent === "success");
  if (events.join(",") !== "mutate:New record,success,settled") throw new Error("Native callback ordering lost");
  if (document.querySelector("#suspense")?.textContent !== "decoded") throw new Error("Timestamp was not decoded");
  await fetch("/__report", { method: "POST", body: JSON.stringify({ ok: true }) });
} catch (error) {
  await fetch("/__report", { method: "POST", body: JSON.stringify({ ok: false, message: String(error) }) });
} finally { root.unmount(); await owner.api.dispose(); owner.cache.clear(); }
`;

const browserHostSource = `import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { reply } from "./native";
const built = await Bun.build({ entrypoints: ["./browser.tsx"], target: "browser", outdir: "./browser-dist" });
assert.equal(built.success, true, built.logs.join("\\n"));
const done = Promise.withResolvers<void>();
let server: ReturnType<typeof Bun.serve> | undefined;
let profile: string | undefined;
let browser: ReturnType<typeof Bun.spawn> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
const interrupted = () => done.reject(new Error("Packed native Firefox interrupted"));
process.once("SIGTERM", interrupted);
try {
server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/") return new Response('<div id="root"></div><script type="module" src="/browser.js"></script>', { headers: { "content-type": "text/html" } });
  if (path === "/browser.js") return new Response(Bun.file("./browser-dist/browser.js"));
  if (path === "/__report") {
    const report = await request.json();
    if (report.ok === true) done.resolve(); else done.reject(new Error(report.message));
    return new Response(null, { status: 204 });
  }
  if (path.startsWith("/_questpie/")) return reply(request);
  return new Response(null, { status: 404 });
} });
profile = await mkdtemp(join(process.cwd(), "firefox-profile-"));
browser = Bun.spawn([process.env.FIREFOX_BIN ?? "/usr/bin/firefox", "--headless", "--no-remote", "--profile", profile, server.url.href], { detached: true, stdout: "ignore", stderr: "ignore", env: { ...process.env, MOZ_HEADLESS: "1" } });
void browser.exited.then(() => done.reject(new Error("Packed native Firefox exited before completion")));
deadline = setTimeout(() => done.reject(new Error("Packed native Firefox timed out")), 30_000);
await done.promise;
console.log("NATIVE_PACKED_BROWSER_PASSED");
} finally {
  clearTimeout(deadline);
  process.removeListener("SIGTERM", interrupted);
  try {
    if (browser) {
      const signal = (value: NodeJS.Signals) => {
        try { process.kill(-browser!.pid, value); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      };
      signal("SIGTERM");
      const escalation = setTimeout(() => signal("SIGKILL"), 1_000);
      try { await browser.exited; }
      finally { clearTimeout(escalation); signal("SIGKILL"); }
    }
  } finally {
    try { await server?.stop(true); }
    finally { if (profile) await rm(profile, { recursive: true, force: true }); }
  }
}
`;

const typesSource = `import { useInfiniteQuery, useSuspenseInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { Owner } from "./native";
export function useNativeTypes(owner: Owner) {
  const page = useInfiniteQuery(owner.infinite);
  const suspense = useSuspenseInfiniteQuery(owner.infinite);
  page.data?.pages[0]?.nodes[0]?.createdAt.toISOString();
  suspense.data.pageParams[0]?.toUpperCase();
  owner.cache.getQueryData(owner.infinite.queryKey)?.pageParams[0]?.toUpperCase();
  // @ts-expect-error timestamp values are decoded Dates
  owner.cache.getQueryData(owner.finite.queryKey)?.nodes[0]?.createdAt.toUpperCase();
  // @ts-expect-error native continuation supplies after
  owner.api.queries["records.nativePage"].infiniteOptions({ archiveCode: "public", first: 1, after: null });
  const mutation = useMutation(owner.api.mutations["record.deposit"].options());
  if (owner.api.mutations["record.deposit"].isError(mutation.error)) {
    const code: "DEPOSIT_DENIED" = mutation.error.code;
    void code;
  }
}
`;
