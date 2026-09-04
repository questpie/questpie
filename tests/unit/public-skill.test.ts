import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { validatePublicQuestpieSkill } from "../../scripts/skill-check";

const publicSkill = resolve(import.meta.dir, "../../skills/questpie");

async function withSkillCopy(
	name: string,
	work: (root: string) => Promise<void>,
): Promise<void> {
	const temporary = await mkdtemp(join(tmpdir(), `questpie-skill-${name}-`));
	const root = join(temporary, "questpie");
	try {
		await cp(publicSkill, root, { recursive: true });
		await work(root);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}

test("the public QUESTPIE skill is portable and closed", () => {
	expect(() => validatePublicQuestpieSkill(publicSkill)).not.toThrow();
});

test("the public skill rejects repository-internal and escaping references", async () => {
	await withSkillCopy("pointers", async (root) => {
		const entry = join(root, "SKILL.md");
		await writeFile(
			entry,
			`${await Bun.file(entry).text()}\nRead HANDOFF.md and [escape](../../SPEC.md).\n`,
		);
		expect(() => validatePublicQuestpieSkill(root)).toThrow(
			"contains internal pointer HANDOFF.md",
		);
	});

	await withSkillCopy("missing-link", async (root) => {
		const entry = join(root, "SKILL.md");
		await writeFile(
			entry,
			`${await Bun.file(entry).text()}\n[missing](references/missing.md)\n`,
		);
		expect(() => validatePublicQuestpieSkill(root)).toThrow(
			"has missing reference references/missing.md",
		);
	});

	await withSkillCopy("missing-guide", async (root) => {
		const entry = join(root, "SKILL.md");
		await writeFile(
			entry,
			`${await Bun.file(entry).text()}\n[missing](https://questpie.com/docs/v4/missing)\n`,
		);
		expect(() => validatePublicQuestpieSkill(root)).toThrow(
			"has missing public guide https://questpie.com/docs/v4/missing",
		);
	});
});

test("the public skill rejects executable payloads and unsupported imports", async () => {
	await withSkillCopy("payload", async (root) => {
		await writeFile(join(root, "install.sh"), "#!/bin/sh\nexit 0\n");
		expect(() => validatePublicQuestpieSkill(root)).toThrow(
			"unexpected public files",
		);
	});

	await withSkillCopy("import", async (root) => {
		const reference = join(root, "references/application-authoring.md");
		await writeFile(
			reference,
			`${await Bun.file(reference).text()}\n\`\`\`ts\nimport { x } from "@questpie/react";\n\`\`\`\n`,
		);
		expect(() => validatePublicQuestpieSkill(root)).toThrow(
			"imports unsupported package @questpie/react",
		);
	});
});
