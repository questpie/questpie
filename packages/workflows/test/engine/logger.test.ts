import { describe, expect, mock, test } from "bun:test";

import type {
	ExternalLogger,
	LogEntry,
} from "../../src/server/engine/logger.js";
import { WorkflowLoggerImpl } from "../../src/server/engine/logger.js";

describe("WorkflowLoggerImpl", () => {
	describe("accumulation", () => {
		test("accumulates log entries", () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("step started");
			logger.warn("slow response");
			logger.error("step failed");

			const entries = logger.getEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0].level).toBe("info");
			expect(entries[0].message).toBe("step started");
			expect(entries[1].level).toBe("warn");
			expect(entries[2].level).toBe("error");
		});

		test("includes data in entries", () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("step result", { value: 42, key: "test" });

			const entries = logger.getEntries();
			expect(entries[0].data).toEqual({ value: 42, key: "test" });
		});

		test("sets null data when not provided", () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("no data");

			const entries = logger.getEntries();
			expect(entries[0].data).toBeNull();
		});

		test("records timestamps", () => {
			const before = new Date();
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("test");
			const after = new Date();

			const entries = logger.getEntries();
			expect(entries[0].timestamp.getTime()).toBeGreaterThanOrEqual(
				before.getTime(),
			);
			expect(entries[0].timestamp.getTime()).toBeLessThanOrEqual(
				after.getTime(),
			);
		});
	});

	describe("log level filtering", () => {
		test("filters below minimum level (default: info)", () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.debug("should be filtered");
			logger.info("should pass");

			const entries = logger.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].level).toBe("info");
		});

		test("respects custom log level", () => {
			const logger = new WorkflowLoggerImpl("inst-1", {
				logLevel: "warn",
			});
			logger.debug("filtered");
			logger.info("filtered");
			logger.warn("passes");
			logger.error("passes");

			const entries = logger.getEntries();
			expect(entries).toHaveLength(2);
			expect(entries[0].level).toBe("warn");
			expect(entries[1].level).toBe("error");
		});

		test("debug level includes all", () => {
			const logger = new WorkflowLoggerImpl("inst-1", {
				logLevel: "debug",
			});
			logger.debug("included");
			logger.info("included");
			logger.warn("included");
			logger.error("included");

			expect(logger.getEntries()).toHaveLength(4);
		});

		test("none level filters everything", () => {
			const logger = new WorkflowLoggerImpl("inst-1", {
				logLevel: "none",
			});
			logger.debug("filtered");
			logger.info("filtered");
			logger.warn("filtered");
			logger.error("filtered");

			expect(logger.getEntries()).toHaveLength(0);
		});
	});

	describe("flush", () => {
		test("flushes entries via callback", async () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("entry 1");
			logger.warn("entry 2");

			let flushedId: string | undefined;
			let flushedEntries: LogEntry[] | undefined;

			await logger.flush(async (id, entries) => {
				flushedId = id;
				flushedEntries = entries;
			});

			expect(flushedId).toBe("inst-1");
			expect(flushedEntries).toHaveLength(2);
			expect(flushedEntries![0].message).toBe("entry 1");
		});

		test("clears entries after flush", async () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			logger.info("entry");

			await logger.flush(async () => {});

			expect(logger.getEntries()).toHaveLength(0);
		});

		test("skips flush when no entries", async () => {
			const logger = new WorkflowLoggerImpl("inst-1");
			const flushFn = mock(async () => {});

			await logger.flush(flushFn);

			expect(flushFn).not.toHaveBeenCalled();
		});
	});

	describe("external logger (dual output)", () => {
		test("forwards to external logger", () => {
			const external: ExternalLogger = {
				debug: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
			};

			const logger = new WorkflowLoggerImpl("inst-1", {
				externalLogger: external,
			});

			logger.info("test message", { key: "value" });

			expect(external.info).toHaveBeenCalledWith("test message", {
				key: "value",
			});
		});

		test("adds prefix to external logger messages", () => {
			const external: ExternalLogger = {
				debug: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
			};

			const logger = new WorkflowLoggerImpl("inst-1", {
				externalLogger: external,
				prefix: "[wf:test]",
			});

			logger.info("hello");

			expect(external.info).toHaveBeenCalledWith("[wf:test] hello", undefined);
		});

		test("forwards even when below internal log level", () => {
			const external: ExternalLogger = {
				debug: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
			};

			const logger = new WorkflowLoggerImpl("inst-1", {
				logLevel: "error",
				externalLogger: external,
			});

			logger.debug("filtered internally");

			// External logger still receives it
			expect(external.debug).toHaveBeenCalled();
			// But internal buffer does NOT record it
			expect(logger.getEntries()).toHaveLength(0);
		});
	});
});
