import { expect, test } from "bun:test";

import { buildTeamSlaBrowserJavaScript } from "../support/team-support-sla-browser";

test("the SLA browser bundle resolves the real native Desk entrypoints", async () => {
	const javascript = await buildTeamSlaBrowserJavaScript();
	expect(javascript).toContain("sla-observer-ready");
	expect(javascript).toContain("sla-observer-updated");
	expect(javascript).toContain("Last SLA follow-up:");
}, 35_000);
