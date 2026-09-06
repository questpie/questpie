import { reportFixturePhase } from "../fixture-control";

/** Browser-only evidence: observes the existing authorized detail, never Jobs. */
export async function observeSlaFollowUp(): Promise<void> {
	const deadline = Date.now() + 60_000;
	let initial: string | undefined;
	while (Date.now() < deadline) {
		const element = document.querySelector<HTMLElement>("[data-sla-follow-up]");
		const value = element?.dataset.slaFollowUp;
		if (initial === undefined && value !== undefined) {
			initial = value;
			await reportFixturePhase({
				phase: "sla-observer-ready",
				initial,
				rendered: element!.textContent,
			});
		} else if (value !== undefined && value !== "" && value !== initial) {
			await reportFixturePhase({
				phase: "sla-observer-updated",
				initial,
				value,
				rendered: element!.textContent,
			});
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(
		"Scheduled SLA follow-up did not appear in the live ticket detail",
	);
}
