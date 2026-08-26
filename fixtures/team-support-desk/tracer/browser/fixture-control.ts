// This fetch controls only the local tracer harness. Authentication uses the
// Better Auth client; application data uses #questpie/client exclusively.
export async function reportFixturePhase(
	value: Readonly<Record<string, unknown>>,
): Promise<void> {
	await fetch("/__team_support/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(value),
	});
}
