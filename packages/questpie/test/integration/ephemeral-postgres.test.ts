import { describe, expect, test } from "bun:test";

import pg from "pg";

const databaseUrl = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
	for (let i = 0; i < 300; i++) {
		if (check()) return;
		await wait(10);
	}
	throw new Error("Timed out waiting for separate process");
}
function worker(channel: string) {
	const messages: any[] = [];
	const child = Bun.spawn(
		[
			process.execPath,
			new URL("../fixtures/ephemeral-process.ts", import.meta.url).pathname,
		],
		{
			env: { ...process.env, EPHEMERAL_TEST_CHANNEL: channel },
			stdout: "ignore",
			stderr: "inherit",
			ipc(message) {
				messages.push(message);
			},
		},
	);
	return {
		child,
		messages,
		async send(message: object) {
			const request = crypto.randomUUID();
			child.send({ ...message, request });
			await until(() => messages.some((m) => m.request === request));
			const result = messages.find((m) => m.request === request);
			if (result.error) throw new Error(result.error);
		},
	};
}

describe.skipIf(!databaseUrl)("ephemeral fan-out on real PostgreSQL", () => {
	test("two OS processes: read-only connections, page isolation, presence, live revocation and one LISTEN per process", async () => {
		const channel = `ephemeral_${crypto.randomUUID().replaceAll("-", "")}`;
		// Proves the lane works with SQL writes forbidden, including join/heartbeat/leave.
		const readOnlyUrl = new URL(databaseUrl!);
		readOnlyUrl.searchParams.set(
			"options",
			"-c default_transaction_read_only=on",
		);
		const previous = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL;
		process.env.QUESTPIE_EPHEMERAL_DATABASE_URL = readOnlyUrl.toString();
		const a = worker(channel),
			b = worker(channel);
		process.env.QUESTPIE_EPHEMERAL_DATABASE_URL = previous;
		const db = new pg.Pool({ connectionString: databaseUrl });
		try {
			await until(
				() =>
					a.messages.some((m) => m.ready) && b.messages.some((m) => m.ready),
			);
			expect(a.child.pid).not.toBe(b.child.pid);
			await a.send({
				operation: "subscribe",
				channel: "page-one",
				id: "ada",
				presence: true,
			});
			await b.send({
				operation: "subscribe",
				channel: "page-one",
				id: "bob",
				presence: true,
			});
			await b.send({
				operation: "subscribe",
				channel: "page-two",
				id: "other",
				presence: true,
			});
			await until(() =>
				b.messages.some(
					(m) =>
						m.subscription === "bob" && m.frame?.data.members?.length === 2,
				),
			);
			await a.send({
				operation: "publish",
				channel: "page-one",
				data: { x: 42 },
			});
			await until(() =>
				b.messages.some(
					(m) =>
						m.subscription === "bob" && m.frame?.type === "channel_ephemeral",
				),
			);
			expect(
				b.messages.some(
					(m) =>
						m.subscription === "other" && m.frame?.type === "channel_ephemeral",
				),
			).toBe(false);
			await b.send({
				operation: "publish",
				channel: "page-one",
				publisher: "b",
				data: { x: 77 },
			});
			await until(() =>
				a.messages.some(
					(m) =>
						m.subscription === "ada" &&
						m.frame?.type === "channel_ephemeral" &&
						m.frame.data.data.x === 77,
				),
			);

			const listeners = await db.query(
				"select count(*)::int as count from pg_stat_activity where query = $1",
				[`LISTEN ${channel}`],
			);
			expect(listeners.rows[0].count).toBe(2);
			await a.send({ operation: "leave", id: "ada" });
			await until(
				() =>
					b.messages
						.filter(
							(m) =>
								m.subscription === "bob" &&
								m.frame?.type === "channel_presence",
						)
						.at(-1)?.frame.data.members.length === 1,
			);
			await b.send({ operation: "allow", allowed: false });
			await until(() => b.messages.some((m) => m.closed === "bob"));
			const before = b.messages.filter(
				(m) => m.frame?.type === "channel_ephemeral",
			).length;
			await a.send({
				operation: "publish",
				channel: "page-one",
				data: { x: 99 },
			});
			await wait(150);
			expect(
				b.messages.filter((m) => m.frame?.type === "channel_ephemeral"),
			).toHaveLength(before);
			expect([...a.messages, ...b.messages].filter((m) => m.error)).toEqual([]);
		} finally {
			await Promise.allSettled([
				a.send({ operation: "stop" }),
				b.send({ operation: "stop" }),
			]);
			a.child.kill();
			b.child.kill();
			await db.end();
		}
	}, 15_000);
});
