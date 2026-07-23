import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import {
	questpieChannelEventTable,
	questpieChannelPresenceTable,
	questpieRealtimeTopologyTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

describe("realtime jsonb encoding", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
		}));
		setup = await buildMockApp({ collections: { posts } });
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	test("stores every realtime JSON document as native jsonb on PGlite", async () => {
		await setup.app.collections.posts.create(
			{ title: "PGlite" },
			createTestContext({ accessMode: "system" }),
		);
		await setup.app.db.insert(questpieChannelEventTable).values({
			channelHash: "channel-hash",
			seq: 1,
			eventId: "event-id",
			channel: "room-1",
			event: "message",
			schemaIdentity: "message-v1",
			payload: "hello",
			sizeBytes: 16,
		});
		await setup.app.db.insert(questpieChannelPresenceTable).values({
			channelHash: "channel-hash",
			connectionId: "connection-id",
			principalId: "principal-id",
			channel: "room-1",
			data: { typing: true },
			expiresAt: new Date(Date.now() + 60_000),
		});
		await setup.app.db.insert(questpieRealtimeTopologyTable).values({
			sessionKey: "session-key",
			ownerId: "owner-id",
			protocolVersion: 1,
			tokenHash: "token-hash",
			identityHash: "identity-hash",
			leaseExpiresAt: new Date(Date.now() + 60_000),
			desiredRevision: 0,
			appliedRevision: 0,
			desiredTopology: {
				protocol: "questpie-realtime-topology",
				version: 1,
				revision: 0,
				topics: [],
				channels: [],
			},
		});

		const result = await setup.app.db.execute(sql`
			select 'outbox' as source, jsonb_typeof(payload) as value_type
			from questpie_realtime_log
			union all
			select 'channel', jsonb_typeof(payload)
			from questpie_channel_event
			union all
			select 'presence', jsonb_typeof(data)
			from questpie_channel_presence
			union all
			select 'topology', jsonb_typeof(desired_topology)
			from questpie_realtime_topology
			order by source
		`);
		const rows = result.rows ?? result;

		expect(rows).toEqual([
			{ source: "channel", value_type: "string" },
			{ source: "outbox", value_type: "object" },
			{ source: "presence", value_type: "object" },
			{ source: "topology", value_type: "object" },
		]);
		const [channelEvent] = await setup.app.db
			.select()
			.from(questpieChannelEventTable);
		expect(channelEvent.payload).toBe("hello");
	});

	test("preserves JSON-looking strings and native scalar types", async () => {
		const payloads: unknown[] = [
			"123",
			"true",
			"null",
			'{"x":1}',
			123,
			true,
			{ x: 1 },
			[1, "two"],
		];
		await setup.app.db.insert(questpieChannelEventTable).values(
			payloads.map((payload, index) => ({
				channelHash: "scalar-matrix",
				seq: index + 1,
				eventId: `event-${index}`,
				channel: "room-1",
				event: "message",
				schemaIdentity: "message-v1",
				payload,
				sizeBytes: 16,
			})),
		);
		await setup.app.db.execute(sql`
			insert into questpie_channel_event (
				channel_hash, seq, event_id, channel, event, schema_identity, payload, size_bytes
			) values (
				'scalar-matrix', 9, 'event-8', 'room-1', 'message', 'message-v1', 'null'::jsonb, 16
			)
		`);

		const rows = await setup.app.db
			.select({ payload: questpieChannelEventTable.payload })
			.from(questpieChannelEventTable)
			.orderBy(questpieChannelEventTable.seq);
		expect(rows.map(({ payload }) => payload)).toEqual([...payloads, null]);
	});
});
