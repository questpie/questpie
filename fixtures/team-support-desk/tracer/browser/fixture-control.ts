export type FixtureSession = Readonly<{
	label: string;
	membershipId: string;
	organizationId: string;
	principalId: string;
	role: "customer" | "agent" | "admin";
}>;

// These two fetches control the local tracer harness. Application Queries,
// Mutations, and Actions always travel through #questpie/client.
export async function loadFixtureSession(): Promise<FixtureSession> {
	const response = await fetch("/__team_support/session", {
		headers: { accept: "application/json" },
	});
	if (!response.ok) throw new Error("signed session unavailable");
	return (await response.json()) as FixtureSession;
}

export async function reportFixturePhase(
	value: Readonly<Record<string, unknown>>,
): Promise<void> {
	await fetch("/__team_support/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(value),
	});
}
