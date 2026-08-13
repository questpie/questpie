import { readFileSync } from "node:fs";

export function validate(matrix: string): void {
	const requiredCells = [
		"definitions",
		"scalar-and-exports",
		"migrations",
		"context",
		"policy",
		"query",
		"mutation",
		"lifecycle",
		"live-query",
		"durable",
		"service-route-auth",
		"ha",
		"accelerators",
		"channel",
		"files",
		"search",
		"projections",
		"envelope",
		"managed-postgres",
		"performance",
	];
	const rows = matrix
		.split("\n")
		.filter((line) => /^\| [a-z]/.test(line))
		.map((line) =>
			line
				.split("|")
				.slice(1, -1)
				.map((value) => value.trim()),
		);
	const byName = new Map<string, string[]>();
	for (const row of rows) {
		if (row.length !== 7 || row.some((value) => value === ""))
			throw new Error(`incomplete matrix row: ${row.join(" | ")}`);
		if (byName.has(row[0]!)) throw new Error(`duplicate cell ${row[0]}`);
		byName.set(row[0]!, row);
	}
	for (const cell of requiredCells) {
		if (!byName.has(cell)) throw new Error(`missing cell ${cell}`);
	}
	if (rows.filter((row) => row[2] === "both").length < 12)
		throw new Error("archive is not exercised across the matrix");
	for (const fixture of ["collaboration", "archive"]) {
		if (!matrix.includes(`\`${fixture}\``))
			throw new Error(`missing ${fixture}`);
	}
	for (const rule of [
		"direct, network, and Studio",
		"ten-instance",
		"B-tree-only",
		"No conformance row asserts RLS",
		"repository owns harness",
		"Each implementation slice owns its exact threshold",
	]) {
		if (!matrix.includes(rule)) throw new Error(`missing invariant: ${rule}`);
	}
	const channel = byName.get("channel")!;
	if (
		!channel[1]!.includes("compiler") ||
		!channel[1]!.includes("Policy") ||
		!channel[1]!.includes("PostgreSQL") ||
		!channel[4]!.includes("changed-payload")
	)
		throw new Error(
			"Channel Resource ownership or hostile coverage is incomplete",
		);
	if (byName.get("accelerators")![1] !== "Runtime capability bindings")
		throw new Error("optional accelerators cannot own application authority");
	for (const forbidden of [
		/\b(?:cache|broker|carrier|byte storage) owns (?:Context|Policy|authority|durable state)\b/i,
		/\bRLS (?:enforces|owns|provides|guarantees)\b/i,
	]) {
		if (forbidden.test(matrix))
			throw new Error(`forbidden authority claim: ${forbidden}`);
	}
}

if (import.meta.main) {
	validate(readFileSync(new URL("./MATRIX.md", import.meta.url), "utf8"));
	console.log("P14 conformance map: 20 required cells valid");
}
