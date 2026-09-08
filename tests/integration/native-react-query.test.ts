import { expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");
const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const timestamp = "2026-09-08T10:00:00.000Z";

test("the public native adapter factory is available without a generated sibling", async () => {
	const integration = await import("questpie/react-query");
	expect(Object.keys(integration)).toEqual(["createQueryAdapter"]);
});

test("full-source native options preserve generated transport, codecs and inferred types", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-native-consumer-"));
	const requests: Array<{
		method: string;
		path: string;
		context: unknown;
		accept: string | null;
	}> = [];
	const ticket = {
		id,
		organizationId: id,
		teamId: id,
		requesterMembershipId: id,
		assigneeMembershipId: null,
		reference: "SUP-1",
		priority: "normal",
		status: "open",
		summary: "Native consumer",
		updatedAt: timestamp,
	};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const query = request.method === "GET";
			requests.push({
				method: request.method,
				path: new URL(request.url).pathname,
				context: query
					? JSON.parse(
							Buffer.from(
								request.headers.get("Questpie-Context")!,
								"base64url",
							).toString(),
						)
					: (await request.json()).context,
				accept: request.headers.get("accept"),
			});
			const header = query ? "Questpie-Call-Id" : "Idempotency-Key";
			return Response.json(
				{
					callId: decodeURIComponent(request.headers.get(header)!),
					result: query
						? {
								nodes: [{ ...ticket, team: null, assignee: null }],
								pageInfo: { endCursor: null, hasNextPage: false },
							}
						: {
								...ticket,
								description: "Native consumer description",
								createdAt: timestamp,
								closedAt: null,
							},
				},
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		},
	});
	try {
		await symlink(
			join(repositoryRoot, "node_modules"),
			join(temporary, "node_modules"),
			"dir",
		);
		const first = await compileApplication({
			applicationRoot: join(repositoryRoot, "fixtures/team-support-desk"),
			outputDirectory: join(temporary, "generated"),
		});
		const relocatedRoot = join(temporary, "relocated");
		await cp(
			join(repositoryRoot, "fixtures/team-support-desk"),
			relocatedRoot,
			{
				recursive: true,
				filter: (source) =>
					!["node_modules", ".questpie"].includes(basename(source)),
			},
		);
		await symlink(
			join(repositoryRoot, "fixtures/team-support-desk/node_modules"),
			join(relocatedRoot, "node_modules"),
			"dir",
		);
		const relocatedOutput = join(relocatedRoot, ".questpie/generated");
		await mkdir(relocatedOutput, { recursive: true });
		const staleClient =
			'throw new Error("stale generated client was loaded");\n';
		await writeFile(join(relocatedOutput, "client.ts"), staleClient);
		for (const path of ["query-projection.json", "query-watchability.json"])
			await writeFile(join(relocatedOutput, path), '{"stale":true}\n');
		const relocated = await compileApplication({
			applicationRoot: relocatedRoot,
			outputDirectory: relocatedOutput,
		});
		expect(await readFile(join(relocatedOutput, "client.ts"), "utf8")).toBe(
			first.generatedFiles["client.ts"]!,
		);
		const clientBundle = await Bun.build({
			entrypoints: [join(relocatedOutput, "client.ts")],
			target: "browser",
			format: "esm",
			plugins: [
				{
					name: "core-client-has-no-native-adapter-runtime",
					setup(build) {
						build.onResolve(
							{ filter: /^(react(?:-dom)?(?:\/|$)|@tanstack\/|@noble\/)/ },
							(args) => {
								throw new Error(
									`Generated client loaded optional integration: ${args.path}`,
								);
							},
						);
					},
				},
			],
		});
		expect(clientBundle.success, clientBundle.logs.map(String).join("\n")).toBe(
			true,
		);
		await writeFile(
			join(temporary, "client-bundle.mjs"),
			await clientBundle.outputs[0]!.text(),
		);
		await writeFile(join(temporary, "consumer.ts"), consumerSource);
		await writeFile(
			join(temporary, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2024",
					module: "ESNext",
					moduleResolution: "Bundler",
					lib: ["ES2024", "DOM"],
					strict: true,
					noUncheckedIndexedAccess: true,
					skipLibCheck: true,
					noEmit: true,
					types: ["bun"],
					paths: {
						"#questpie/app": [join(temporary, "generated/app.ts")],
						"#questpie/source/*": [
							join(repositoryRoot, "fixtures/team-support-desk/src/*"),
						],
					},
				},
				files: ["consumer.ts"],
			}),
		);
		const types = Bun.spawnSync(
			[
				"bun",
				join(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"-p",
				join(temporary, "tsconfig.json"),
				"--extendedDiagnostics",
				"--pretty",
				"false",
			],
			{ cwd: temporary, stdout: "pipe", stderr: "pipe" },
		);
		expect(
			types.exitCode,
			types.stdout.toString() + types.stderr.toString(),
		).toBe(0);
		const diagnostics = types.stdout.toString();
		const measurements = Object.fromEntries(
			["Types", "Instantiations"].map((label) => {
				const match = diagnostics.match(
					new RegExp(`^${label}:\\s+(\\d+)`, "m"),
				);
				expect(
					match,
					`native consumer TypeScript omitted ${label}`,
				).not.toBeNull();
				const value = Number(match![1]);
				expect(value).toBeGreaterThan(0);
				return [label, value];
			}),
		);
		console.log(
			JSON.stringify({ scenario: "native-react-query-consumer", measurements }),
		);
		try {
			expect(relocated.generatedFiles).toEqual(first.generatedFiles);
		} catch (error) {
			// Preserve this rare failure after both builds, without instrumenting
			// resolution or changing the inter-build schedule. These are synthetic
			// fixture artifacts, not request data or environment values.
			try {
				const evidence = await mkdtemp(
					join(tmpdir(), "questpie-native-relocation-failure-"),
				);
				await Promise.all([
					writeFile(
						join(evidence, "original.json"),
						JSON.stringify(first.generatedFiles),
					),
					writeFile(
						join(evidence, "relocated.json"),
						JSON.stringify(relocated.generatedFiles),
					),
				]);
				console.error(JSON.stringify({ relocationFailureArtifacts: evidence }));
			} catch {
				console.error("Could not retain native relocation failure artifacts");
			}
			throw error;
		}
		const consumer = await import(
			pathToFileURL(join(temporary, "consumer.ts")).href
		);
		const generatedBundle = await import(
			pathToFileURL(join(temporary, "client-bundle.mjs")).href
		);
		const result = await consumer.run(
			server.url.origin,
			id,
			generatedBundle.createClient,
		);
		expect(result).toEqual({
			queryDate: timestamp,
			mutationDate: timestamp,
			opaque: true,
			lazy: true,
		});
		expect(requests.map((request) => [request.method, request.path])).toEqual([
			["GET", "/_questpie/query/tickets.queue"],
			["POST", "/_questpie/mutation/ticket.create"],
		]);
		expect(requests[0]!.context).toEqual({
			organizationId: id,
			membershipId: id,
		});
		expect(requests[1]!.context).toEqual(requests[0]!.context);
		expect(requests[0]!.accept).not.toBe("text/event-stream");
	} finally {
		await server.stop(true);
		await rm(temporary, { recursive: true, force: true });
	}
}, 60_000);

test("the built factory bundles hashing without requiring native runtime peers at import time", async () => {
	const built = await Bun.build({
		entrypoints: [
			join(repositoryRoot, "packages/questpie/dist/react-query/index.js"),
			join(repositoryRoot, "packages/questpie/dist/index.js"),
		],
		target: "browser",
		plugins: [
			{
				name: "factory-import-needs-no-host-hashing-or-native-hooks",
				setup(build) {
					build.onResolve(
						{ filter: /^(react(?:-dom)?(?:\/|$)|@tanstack\/|@noble\/)/ },
						(args) => {
							throw new Error(
								`Factory still has an unbundled runtime dependency: ${args.path}`,
							);
						},
					);
				},
			},
		],
	});
	expect(built.success, built.logs.map(String).join("\n")).toBe(true);
	expect(
		await Bun.file(
			join(
				repositoryRoot,
				"packages/questpie/dist/react-query/THIRD-PARTY-LICENSE.txt",
			),
		).text(),
	).toContain("MIT License");
});

const consumerSource = `
import { MutationObserver, QueryClient, useMutation, useQuery, useSuspenseQuery, useInfiniteQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";
import { createClient } from "./generated/client";

export async function run(baseUrl: string, id: string, clientFactory: typeof createClient = createClient) {
  const client = clientFactory({ baseUrl });
  const scope = client.withContext({ organizationId: id, membershipId: id });
  const cache = new QueryClient();
  const adapter = createQueryAdapter(scope, cache, { ssr: true });
  try {
    const options = adapter.queries["tickets.queue"].options({ after: null, first: 1, statuses: null, teamIds: null });
    const lazy = cache.getQueryCache().getAll().length === 0;
    const query = await cache.fetchQuery(options);
    const mutation = new MutationObserver(cache, adapter.mutations["ticket.create"].options());
    const created = await mutation.mutate({ teamId: id, reference: "SUP-1", summary: "Native consumer", description: "Native consumer description" });
    return {
      queryDate: query.nodes[0]?.updatedAt.toISOString(),
      mutationDate: created.updatedAt.toISOString(),
      opaque: !("canonicalScope" in scope) && !("getClientProjection" in scope),
      lazy,
    };
  } finally {
    await adapter.dispose();
    cache.clear();
  }
}

export function useTypes(scope: ReturnType<ReturnType<typeof createClient>["withContext"]>, cache: QueryClient, id: string, failure: unknown) {
  const adapter = createQueryAdapter(scope, cache);
  const options = adapter.queries["tickets.queue"].options({ after: null, first: 1, statuses: null, teamIds: null });
  useQuery(options).data?.nodes[0]?.updatedAt.toISOString();
  useSuspenseQuery(options).data.nodes[0]?.updatedAt.toISOString();
  cache.getQueryData(options.queryKey)?.nodes[0]?.updatedAt.toISOString();
  const forward = adapter.queries["tickets.queue"].infiniteOptions({ first: 1, statuses: null, teamIds: null });
  useInfiniteQuery(forward).data?.pages[0]?.nodes[0]?.updatedAt.toISOString();
  useSuspenseInfiniteQuery(forward).data.pages[0]?.nodes[0]?.updatedAt.toISOString();
  const mutation = adapter.mutations["ticket.create"];
  if (mutation.isError(failure)) {
    const code: "INVALID_TICKET" | "TICKET_UNAVAILABLE" = failure.code;
    void code;
  }
  useMutation({ ...mutation.options(), onMutate(input) { return { reference: input.reference }; }, onSuccess(output, input, context) {
    output.updatedAt.toISOString();
    input.summary.toUpperCase();
    context.reference.toUpperCase();
    // @ts-expect-error native onMutate context is inferred, not untyped
    context.reference.toFixed();
  } });
  // @ts-expect-error result timestamp is decoded, not a string
  useQuery(options).data?.nodes[0]?.updatedAt.toUpperCase();
  // @ts-expect-error unknown operation is not an authored registry escape
  adapter.queries["tickets.missing"];
  // @ts-expect-error page-shaped handlers do not get compiler paging authority
  adapter.queries["tickets.detail"].infiniteOptions({ id });
  // @ts-expect-error generated cursor is not a caller-authored infinite input
  adapter.queries["tickets.queue"].infiniteOptions({ first: 1, statuses: null, teamIds: null, after: null });
  // @ts-expect-error no public descriptor getter
  scope.getClientProjection();
  // @ts-expect-error structural lookalike is not a generated scope
  createQueryAdapter({ queries: scope.queries, mutations: scope.mutations }, cache);
  // @ts-expect-error ordinary Query input retains exact generated codec types
  adapter.queries["tickets.queue"].options({ after: null, first: "one", statuses: null, teamIds: null });
  // @ts-expect-error arbitrary errors cannot be treated as declared domain errors
  failure.payload;
}
`;
