import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection } from "questpie";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createMcpServer } from "../src/exports/index.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "resource-boundary-test",
		version: "1.0.0",
	});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

function resourceConfig(
	operation: boolean | (() => boolean | Promise<boolean>),
	execution: Record<string, unknown> = {},
) {
	return {
		crud: {
			collections: {
				bounded: {
					operations: { list: operation },
				},
			},
		},
		resources: { collections: { bounded: true } },
		execution,
	};
}

describe("MCP resource execution boundary", () => {
	it("bounds serialized resource output", async () => {
		const bounded = collection("bounded")
			.fields(({ f }) => ({
				title: f.text().description({ en: "x".repeat(2000) }),
			}))
			.access({ read: true });
		const setup = await buildMockApp({ collections: { bounded } });
		const server = await createMcpServer(setup.app, {
			config: resourceConfig(true, { maxOutputBytes: 256 }),
		});
		const { client, close } = await connect(server);

		try {
			await expect(
				client.readResource({
					uri: "questpie://schema/collections/bounded",
				}),
			).rejects.toThrow("output_too_large");
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("applies a resource deadline and never emits raw internal messages", async () => {
		let checks = 0;
		const diagnostics: unknown[] = [];
		const bounded = collection("bounded")
			.fields(({ f }) => ({ title: f.text() }))
			.access({ read: true });
		const setup = await buildMockApp({ collections: { bounded } });
		const operation = async () => {
			checks += 1;
			if (checks > 1) {
				await Bun.sleep(50);
				throw new Error("postgres://admin:password@db Bearer secret-token");
			}
			return true;
		};
		const server = await createMcpServer(setup.app, {
			config: resourceConfig(operation, {
				timeoutMs: 10,
				onDiagnostic: (event: unknown) => {
					diagnostics.push(event);
				},
			}),
		});
		const { client, close } = await connect(server);

		try {
			await expect(
				client.readResource({
					uri: "questpie://schema/collections/bounded",
				}),
			).rejects.toThrow("timeout");
			await Bun.sleep(0);
			const serialized = JSON.stringify(diagnostics);
			expect(serialized).toContain('"code":"timeout"');
			expect(serialized).not.toContain("password");
			expect(serialized).not.toContain("secret-token");
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("propagates SDK resource cancellation into the shared boundary", async () => {
		let checks = 0;
		let markStarted!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const diagnostics: unknown[] = [];
		const bounded = collection("bounded")
			.fields(({ f }) => ({ title: f.text() }))
			.access({ read: true });
		const setup = await buildMockApp({ collections: { bounded } });
		const operation = async () => {
			checks += 1;
			if (checks > 1) {
				markStarted();
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			return true;
		};
		const server = await createMcpServer(setup.app, {
			config: resourceConfig(operation, {
				timeoutMs: 1000,
				onDiagnostic: (event: unknown) => {
					diagnostics.push(event);
				},
			}),
		});
		const { client, close } = await connect(server);
		const controller = new AbortController();
		const reading = client.readResource(
			{ uri: "questpie://schema/collections/bounded" },
			{ signal: controller.signal },
		);
		await started;
		controller.abort();

		try {
			await expect(reading).rejects.toThrow();
			await Bun.sleep(0);
			expect(JSON.stringify(diagnostics)).toContain('"code":"cancelled"');
		} finally {
			release?.();
			await close();
			await setup.cleanup();
		}
	});
});
