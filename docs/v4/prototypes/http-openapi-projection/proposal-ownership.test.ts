import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL(
	"../../implementation/beta2-execution-breadth/",
	import.meta.url,
);

test("Kernel HTTP and Product OpenAPI owners stay linked and below the normative budget", async () => {
	const [kernel, product, adr] = await Promise.all([
		readFile(new URL("CANONICAL-HTTP-CONTRACT.md", root), "utf8"),
		readFile(new URL("HTTP-OPENAPI-PROPOSAL.md", root), "utf8"),
		readFile(
			new URL(
				"../../../adr/0036-freeze-canonical-operation-http-and-openapi-projection.md",
				import.meta.url,
			),
			"utf8",
		),
	]);
	expect(kernel.split("\n").length).toBeLessThan(300);
	expect(product.split("\n").length).toBeLessThan(300);
	expect(kernel).toContain(
		"[HTTP-OPENAPI-PROPOSAL.md](./HTTP-OPENAPI-PROPOSAL.md)",
	);
	expect(product).toContain(
		"[CANONICAL-HTTP-CONTRACT.md](./CANONICAL-HTTP-CONTRACT.md)",
	);
	expect(kernel).toContain("## Sole supersession and ratification boundary");
	expect(product).not.toMatch(/^## .*supersession/gmu);
	expect(adr).toContain("CANONICAL-HTTP-CONTRACT.md");
	expect(adr).toContain("HTTP-OPENAPI-PROPOSAL.md");
});
