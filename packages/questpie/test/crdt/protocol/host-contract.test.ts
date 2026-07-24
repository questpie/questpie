import { describe, expect, it } from "bun:test";

import type { ElysiaAdapterConfig } from "../../../../elysia/src/server.js";
import type {
	CrdtHostApplicationV1,
	CrdtHostSocketPeerV1,
	CrdtHostSocketSessionV1,
	CrdtHostTransportV1,
} from "../../../src/server/modules/core/integrated/crdt/host.js";

describe("CRDT host contract", () => {
	it("freezes a compression-free QPCR v1 host attachment", () => {
		const session: CrdtHostSocketSessionV1 = {
			message: async (data) => {
				expect(data).toEqual(Uint8Array.of(1));
			},
			drain: async () => {},
			close: async () => {},
		};
		const peer: CrdtHostSocketPeerV1 = {
			send: () => true,
			close: () => {},
		};
		const application: CrdtHostApplicationV1 = {
			protocol: "QPCR/1.0",
			handleTicket: async () => new Response(null, { status: 204 }),
			handleAgentTicket: async () => new Response(null, { status: 204 }),
			openSocket: async (input) => {
				expect(input.clientIp).toBe("127.0.0.1");
				expect(input.peer).toBe(peer);
				return session;
			},
			stop: async () => {},
		};
		const host: CrdtHostTransportV1 = {
			kind: "questpie-crdt-host",
			protocol: "QPCR/1.0",
			runtime: "bun",
			compression: false,
			attach: async (input) => {
				expect(input.path).toBe("/crdt");
				expect(input.application).toBe(application);
			},
		};
		expect(host.compression).toBe(false);
	});

	it("types the Elysia CRDT path relative to basePath", () => {
		const config = {
			basePath: "/api",
			crdt: { path: "/crdt" },
		} satisfies ElysiaAdapterConfig;
		expect(config).toEqual({
			basePath: "/api",
			crdt: { path: "/crdt" },
		});
	});
});
