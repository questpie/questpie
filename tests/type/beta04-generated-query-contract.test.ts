import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("emits the exact selected Message page and no aggregate capability", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta04-query-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/query-contract-consumer.ts"),
			`import type { QueryContext } from "#questpie/app";
import { channelMessagePage } from "./message-page";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

function execute(ctx: QueryContext) {
	return ctx.data.run(channelMessagePage, {
		channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		first: 20,
		after: null,
	});
}
type Result = Expect<Equal<
	Awaited<ReturnType<typeof execute>>,
	Readonly<{
		nodes: Array<{
			author: { id: string; role: string } | null;
			body?: string;
			createdAt: string;
			id: string;
		}>;
		pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean }>;
	}>
>>;

type NoCount = Expect<Equal<Extract<keyof QueryContext["data"], "count">, never>>;
void (0 as unknown as Result);
void (0 as unknown as NoCount);
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'run(plan: (typeof import("#questpie/source/message-page.ts"))["channelMessagePage"], input: (typeof import("#questpie/source/message-page.ts"))["channelMessagePage"]["parameters"]): Promise<Readonly<{ nodes: Array<{ "author": { "id": string; "role": string; } | null; "body"?: string; "createdAt": string; "id": string; }>; pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean; }>; }>>;',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
