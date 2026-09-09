import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("the credential-owned Desk subtree loads its queue and creates through one native owner", async () => {
	const { testNativeDeskSession } = await import("./native-desk-session");
	await testNativeDeskSession();
}, 10_000);

for (const outcome of [
	"unknown",
	"known-commit",
	"rejected",
	"success",
] as const) {
	test(`native pending comment intent never restores removed data after ${outcome}`, async () => {
		const { testNativeDeskPendingIntent } =
			await import("./native-desk-detail");
		await testNativeDeskPendingIntent(outcome);
	}, 10_000);
}

test("credential replacement retires pending native create work at equal Context", async () => {
	const { testNativeDeskCredentialReplacement } =
		await import("./native-desk-session");
	await testNativeDeskCredentialReplacement();
}, 10_000);

test("a rejected pending comment cannot roll back another native control's committed edit", async () => {
	const { testNativeDeskOverlappingIntent } =
		await import("./native-desk-detail");
	await testNativeDeskOverlappingIntent();
}, 10_000);

test("Team Support Desk uses one native result owner for each displayed Query", () => {
	expect(readFileSync(import.meta.path, "utf8")).not.toMatch(
		/from ["']questpie\/react["']/u,
	);
	const browserRoot = resolve(import.meta.dir, "../../web");
	const sources = [
		readFileSync(resolve(browserRoot, "app.tsx"), "utf8"),
		readFileSync(resolve(browserRoot, "questpie.ts"), "utf8"),
		readFileSync(resolve(browserRoot, "tickets/detail.tsx"), "utf8"),
		readFileSync(resolve(browserRoot, "tickets/selected.tsx"), "utf8"),
	].join("\n");

	expect(sources).toContain('from "@tanstack/react-query"');
	expect(sources).toContain('from "questpie/react-query"');
	expect(sources).toContain('["tickets.queue"].options(');
	expect(sources).toContain('["tickets.detail"].options(');
	expect(sources).toContain('["labels.page"].options(');
	expect(sources).not.toMatch(
		/comments\.page|commentsSnapshot|CommentPage|commentPagePlan|queueRequest|detailRequest|filterSnapshot|pageSnapshot|refreshCurrentQueue|loadQueue|selectTicket|\.watch\(|\.observe\(|useQueryResource/u,
	);
	const gate = readFileSync(resolve(browserRoot, "auth/gate.tsx"), "utf8");
	expect(gate).toContain("key={JSON.stringify([");
	expect(gate).toContain("sessionQuery.data.session.id");
	expect(gate).toContain("session.membershipId");
	expect(gate).toContain("session.organizationId");
});
