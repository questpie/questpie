import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const typescriptCompiler = resolve(
	import.meta.dir,
	"../../node_modules/typescript/bin/tsc",
);

test("emits exact non-recursive root Execution declarations", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta03-execution-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/execution-contract-consumer.ts"),
			`import type {
	AppContextInput,
	AppResolvedContext,
	ExecutionInput,
	ExecutionServices,
	GeneratedApp,
	RootExecution,
} from "#questpie/app";
import { principal } from "questpie";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

type ContextInput = Expect<Equal<
	AppContextInput,
	Readonly<{ companyId: string }>
>>;
type ResolvedContext = Expect<Equal<
	AppResolvedContext,
	Readonly<{
		tenant: Readonly<{ id: string }>;
		values: Readonly<{
			selectedMembershipPrincipalId: string;
			selectedMembershipScope: string;
			selectedRole: string;
		}>;
	}>
>>;
type AuditConnection = Expect<Equal<
	ExecutionServices["audit.connection"],
	Readonly<{ id: number }>
>>;
type ExecutionAudit = Expect<Equal<
	ExecutionServices["audit.execution"],
	Readonly<{ connectionId: number; id: number }>
>>;
type OrdinaryAuthority = Expect<Equal<
	RootExecution["authority"],
	Readonly<{ kind: "ordinary" }>
>>;
type NoRecursiveApp = Expect<Equal<
	Extract<keyof RootExecution, "app">,
	never
>>;

const validInput: ExecutionInput = {
	principal: principal.user({ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" }),
	context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
};
// @ts-expect-error ordinary callers cannot select Authority
const elevatedInput: ExecutionInput = { ...validInput, authority: { kind: "system" } };

function exercise(app: GeneratedApp) {
	return app.execution(validInput, async (execution) => {
		const connectionId: number = execution.services["audit.execution"].connectionId;
		const companyId: string = execution.tenant.id;
		return { companyId, connectionId };
	});
}
type Result = Expect<Equal<
	Awaited<ReturnType<typeof exercise>>,
	{ companyId: string; connectionId: number }
>>;

void (0 as unknown as ContextInput);
void (0 as unknown as ResolvedContext);
void (0 as unknown as AuditConnection);
void (0 as unknown as ExecutionAudit);
void (0 as unknown as OrdinaryAuthority);
void (0 as unknown as NoRecursiveApp);
void (0 as unknown as Result);
void elevatedInput;
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const appContract = compilation.generatedFiles["app.ts"] ?? "";
		expect(appContract).toContain("export type RootExecution");
		expect(appContract).not.toMatch(/\bany\b|AppContract<|GeneratedApp</);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("resolves generated Execution source types through the fixture mapping", async () => {
	await compileApplication({ applicationRoot: fixtureRoot });
	const result = Bun.spawnSync(
		[
			"bun",
			typescriptCompiler,
			"-p",
			join(fixtureRoot, "tsconfig.json"),
			"--pretty",
			"false",
		],
		{ cwd: fixtureRoot, stderr: "pipe", stdout: "pipe" },
	);
	const diagnostics = `${result.stdout.toString()}${result.stderr.toString()}`;
	expect(diagnostics).toBe("");
	expect(result.exitCode).toBe(0);
});
