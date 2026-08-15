import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("projects a Package-owned Service without host Context authority", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const services = JSON.parse(
		compilation.generatedFiles["service-projection.json"] ?? "null",
	);
	const originMap = JSON.parse(
		compilation.generatedFiles["origin-map.json"] ?? "null",
	);
	const auditReader = services.services.find(
		(service: { identity: string }) =>
			service.identity === "service:questpie.auditReader",
	);
	expect(auditReader).toMatchObject({
		identity: "service:questpie.auditReader",
		owner: {
			kind: "package",
			packageId: originMap.packages[0]?.id,
		},
		lifetime: "execution",
		effect: "read",
		dependencies: [],
	});

	const packageContractPath = Object.keys(compilation.generatedFiles).find(
		(path) => path.startsWith("internal/package-contracts/"),
	);
	const packageContract = packageContractPath
		? compilation.generatedFiles[packageContractPath]
		: "";
	expect(packageContract).toContain("PackageServices");
	expect(packageContract).toContain('readonly "questpie.auditReader"');
	expect(packageContract).not.toContain("AppContextInput");
	expect(packageContract).not.toContain("audit.execution");
});
