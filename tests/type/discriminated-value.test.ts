import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("discriminated helpers preserve exact value and branch types", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-discriminated-types-"),
	);
	try {
		const fixture = join(temporary, "authoring.ts");
		await writeFile(
			fixture,
			`import {
  type DiscriminatedReference,
  type DiscriminatedValue,
  matchDiscriminated,
} from "questpie";

declare const appointmentIdBrand: unique symbol;
type AppointmentId = string & { readonly [appointmentIdBrand]: true };
declare const barberIdBrand: unique symbol;
type BarberId = string & { readonly [barberIdBrand]: true };

type Subject = DiscriminatedReference<{
  appointment: AppointmentId;
  barber: BarberId;
}>;
declare let subject: Subject;
declare const replacementId: Subject["id"];
// @ts-expect-error discriminants are readonly
subject.kind = "appointment";
// @ts-expect-error reference IDs are readonly
subject.id = replacementId;

function render(value: Subject) {
  return matchDiscriminated(value, {
    appointment: ({ id }) => {
      const exact: AppointmentId = id;
      return { href: \`/appointments/\${exact}\` } as const;
    },
    barber: ({ id }) => {
      const exact: BarberId = id;
      return \`barber:\${exact}\`;
    },
  });
}

type Rendered = ReturnType<typeof render>;
const result: string | Readonly<{ href: string }> = null as never as Rendered;
void result;

interface ActivityVariants {
  readonly created: { readonly at: Date };
  readonly closed: { readonly reason: string };
}
type Activity = DiscriminatedValue<ActivityVariants>;
declare const activity: Activity;
// @ts-expect-error variant fields are readonly
activity.kind === "created" && (activity.at = new Date());

// @ts-expect-error every variant is required
matchDiscriminated(activity, { created: ({ at }) => at });

matchDiscriminated(activity, {
  created: ({ at }) => at,
  closed: ({ reason }) => reason,
  // @ts-expect-error extra branches are not accepted
  other: () => null,
});
`,
		);
		await writeFile(
			join(temporary, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					baseUrl: repositoryRoot,
					ignoreDeprecations: "6.0",
					lib: ["DOM", "ESNext"],
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: { questpie: ["packages/questpie/src/index.ts"] },
					skipLibCheck: true,
					strict: true,
					target: "ESNext",
					types: [],
				},
				files: [fixture],
			}),
		);

		const result = Bun.spawnSync(
			[
				"bun",
				"node_modules/typescript/bin/tsc",
				"-p",
				join(temporary, "tsconfig.json"),
				"--pretty",
				"false",
			],
			{ cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
		);
		expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
