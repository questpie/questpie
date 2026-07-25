import { describe, expect, it } from "bun:test";

import { acquireGeneratedApp } from "../../src/server/config/generated-app-registry.js";

describe("generated app registry", () => {
	it("isolates separate app definitions that intentionally share one public URL", async () => {
		const url = "https://same.example.com";
		let destroyedA = 0;
		let destroyedB = 0;
		const leaseA = acquireGeneratedApp(uniqueIdentity("a"), async () => ({
			url,
			async destroy() {
				destroyedA++;
			},
		}));
		const leaseB = acquireGeneratedApp(uniqueIdentity("b"), async () => ({
			url,
			async destroy() {
				destroyedB++;
			},
		}));

		const [appA, appB] = await Promise.all([leaseA.promise, leaseB.promise]);
		expect(appA).not.toBe(appB);
		expect(appA.url).toBe(appB.url);
		await Promise.all([leaseA.release(), leaseB.release()]);
		expect([destroyedA, destroyedB]).toEqual([1, 1]);
	});

	it("shares duplicate chunks and destroys only after their final lease", async () => {
		const identity = uniqueIdentity("duplicate");
		let creates = 0;
		let destroys = 0;
		const create = async () => {
			creates++;
			return {
				async destroy() {
					destroys++;
				},
			};
		};
		const first = acquireGeneratedApp(identity, create);
		const second = acquireGeneratedApp(identity, create);

		expect(await first.promise).toBe(await second.promise);
		expect(creates).toBe(1);
		await first.release();
		expect(destroys).toBe(0);
		await second.release();
		expect(destroys).toBe(1);
		await second.release();
		await first.shutdown();
		expect(destroys).toBe(1);
	});

	it("lets the process host shut down a duplicated production app exactly once", async () => {
		const identity = uniqueIdentity("production-shutdown");
		let destroys = 0;
		const create = async () => ({
			async destroy() {
				destroys++;
			},
		});
		const mainChunk = acquireGeneratedApp(identity, create);
		const ssrChunk = acquireGeneratedApp(identity, create);
		expect(await mainChunk.promise).toBe(await ssrChunk.promise);

		await Promise.all([mainChunk.shutdown(), ssrChunk.shutdown()]);
		expect(destroys).toBe(1);
		await Promise.all([mainChunk.release(), ssrChunk.release()]);
		expect(destroys).toBe(1);
	});

	it("deduplicates a final HMR release racing host shutdown", async () => {
		let destroys = 0;
		const lease = acquireGeneratedApp(
			uniqueIdentity("release-shutdown-race"),
			async () => ({
				async destroy() {
					destroys++;
				},
			}),
		);
		await lease.promise;

		await Promise.all([lease.release(), lease.shutdown()]);
		expect(destroys).toBe(1);
	});
});

function uniqueIdentity(suffix: string): string {
	return `test:${suffix}:${globalThis.crypto.randomUUID()}`;
}
