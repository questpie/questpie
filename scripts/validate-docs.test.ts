import { describe, expect, test } from "bun:test";

import { findPublicDocsProvenance } from "./validate-docs";

describe("public docs provenance guard", () => {
	test("rejects audit markers and internal source paths in public prose", () => {
		const issues = findPublicDocsProvenance(`---
title: Collections
---

Sources: packages/questpie/src/server/collection/crud.ts:42
`);

		expect(issues.map((issue) => issue.id)).toEqual([
			"provenance-marker",
			"internal-repository-path",
			"file-line-reference",
		]);
	});

	test("allows public imports and source-shaped paths inside code examples", () => {
		const issues = findPublicDocsProvenance(`---
title: Collections
---

Read the [runnable example](https://github.com/questpie/questpie/tree/main/examples/city-portal).

\`\`\`ts title="packages/example/src/index.ts"
import { collection } from "#questpie/factories";
\`\`\`
`);

		expect(issues).toEqual([]);
	});
});
