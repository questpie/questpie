import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	bootstrapChecksum,
	bootstrapSql,
} from "../../packages/compiler/src/schema-postgres";

test("embeds the authoritative bootstrap SQL bytes and checksum exactly", async () => {
	const authority = await readFile(
		resolve(import.meta.dir, "../../docs/v4/schema-bootstrap-v1.sql"),
		"utf8",
	);
	const checksum = createHash("sha256")
		.update("questpie-internal-bootstrap-v1\0")
		.update(authority)
		.digest("hex");

	expect(bootstrapSql).toBe(authority);
	expect(bootstrapChecksum).toBe(checksum);
});
