import { describe, expect, it } from "bun:test";

import {
	brokerUrlRejection,
	clampInt,
	DENO_DEFAULT_IMPORT_HOSTS,
	extractResult,
	importFlags,
	netFlag,
	normalizeBrokerUrl,
	RESULT_MARKER,
} from "../src/server-internals.js";

describe("normalizeBrokerUrl", () => {
	it("drops a trailing slash", () => {
		expect(normalizeBrokerUrl("https://broker.example/rpc/")).toBe(
			"https://broker.example/rpc",
		);
	});
	it("lowercases the origin but preserves path case", () => {
		expect(normalizeBrokerUrl("HTTPS://Broker.Example/RPC")).toBe(
			"https://broker.example/RPC",
		);
	});
	it("treats equivalent URLs as equal after normalization", () => {
		expect(normalizeBrokerUrl("http://HOST:8080/rpc/")).toBe(
			normalizeBrokerUrl("http://host:8080/rpc"),
		);
	});
	it("returns null on garbage input", () => {
		expect(normalizeBrokerUrl("not a url")).toBeNull();
		expect(normalizeBrokerUrl("")).toBeNull();
	});
});

describe("brokerUrlRejection", () => {
	it("returns null when no expectation is configured (undefined)", () => {
		expect(brokerUrlRejection("http://anything/rpc", undefined)).toBeNull();
	});
	it("returns null when no expectation is configured (empty string)", () => {
		expect(brokerUrlRejection("http://anything/rpc", "")).toBeNull();
	});
	it("accepts a matching URL", () => {
		expect(
			brokerUrlRejection("http://host:8080/rpc", "http://host:8080/rpc"),
		).toBeNull();
	});
	it("accepts an equivalent (trailing-slash / case) URL", () => {
		expect(
			brokerUrlRejection("http://HOST:8080/rpc/", "http://host:8080/rpc"),
		).toBeNull();
	});
	it("rejects a missing url (non-string)", () => {
		expect(brokerUrlRejection(undefined, "http://host/rpc")).toBe(
			"bindings.url is missing",
		);
		expect(brokerUrlRejection(123, "http://host/rpc")).toBe(
			"bindings.url is missing",
		);
	});
	it("rejects an empty-string url", () => {
		expect(brokerUrlRejection("", "http://host/rpc")).toBe(
			"bindings.url is missing",
		);
	});
	it("rejects an invalid url", () => {
		expect(brokerUrlRejection("not a url", "http://host/rpc")).toBe(
			"bindings.url is not a valid URL: not a url",
		);
	});
	it("rejects a mismatched url", () => {
		expect(
			brokerUrlRejection("http://evil.example/rpc", "http://host:8080/rpc"),
		).toBe("bindings.url does not match the configured broker URL");
	});
});

describe("clampInt", () => {
	it("returns the default for non-finite input", () => {
		expect(clampInt("abc", 5, 1, 10)).toBe(5);
		expect(clampInt(undefined, 5, 1, 10)).toBe(5);
		expect(clampInt(Number.NaN, 5, 1, 10)).toBe(5);
		expect(clampInt(Number.POSITIVE_INFINITY, 5, 1, 10)).toBe(5);
	});
	it("clamps below the minimum", () => {
		expect(clampInt(0, 5, 2, 10)).toBe(2);
		expect(clampInt(-100, 5, 2, 10)).toBe(2);
	});
	it("clamps above the maximum", () => {
		expect(clampInt(999, 5, 2, 10)).toBe(10);
	});
	it("rounds to the nearest integer", () => {
		expect(clampInt(4.4, 0, 0, 10)).toBe(4);
		expect(clampInt(4.6, 0, 0, 10)).toBe(5);
	});
	it("parses numeric strings", () => {
		expect(clampInt("7", 0, 0, 10)).toBe(7);
	});
});

describe("netFlag", () => {
	it("returns no flag for an empty list", () => {
		expect(netFlag([])).toEqual([]);
	});
	it("returns no flag for whitespace-only hosts", () => {
		expect(netFlag(["  ", "\t"])).toEqual([]);
	});
	it("trims and comma-joins the surviving hosts", () => {
		expect(netFlag(["a.com:443", "  ", "b.com"])).toEqual([
			"--allow-net=a.com:443,b.com",
		]);
	});
});

describe("importFlags", () => {
	it("deny-imports ALL default hosts when the list is empty", () => {
		expect(importFlags([])).toEqual([
			`--deny-import=${DENO_DEFAULT_IMPORT_HOSTS.join(",")}`,
		]);
	});
	it("exposes the 7 known Deno default import hosts", () => {
		expect(DENO_DEFAULT_IMPORT_HOSTS).toEqual([
			"deno.land:443",
			"jsr.io:443",
			"esm.sh:443",
			"raw.esm.sh:443",
			"cdn.jsdelivr.net:443",
			"raw.githubusercontent.com:443",
			"gist.githubusercontent.com:443",
		]);
	});
	it("allow-imports only the given hosts (REPLACING defaults)", () => {
		expect(importFlags(["esm.sh:443"])).toEqual([
			"--allow-import=esm.sh:443",
		]);
	});
	it("trims and joins multiple allowed hosts", () => {
		expect(importFlags(["esm.sh:443", "  ", "jsr.io:443"])).toEqual([
			"--allow-import=esm.sh:443,jsr.io:443",
		]);
	});
	it("deny-imports when only whitespace hosts are given", () => {
		expect(importFlags(["  "])).toEqual([
			`--deny-import=${DENO_DEFAULT_IMPORT_HOSTS.join(",")}`,
		]);
	});
});

describe("extractResult", () => {
	it("parses the JSON on the marked line", () => {
		const stdout = `some log\n${RESULT_MARKER}{"ok":true,"output":42,"logs":["a"]}\n`;
		expect(extractResult(stdout, RESULT_MARKER)).toEqual({
			ok: true,
			output: 42,
			error: undefined,
			logs: ["a"],
		});
	});
	it("parses a marked line at end-of-string (no trailing newline)", () => {
		const stdout = `${RESULT_MARKER}{"ok":true,"output":"x","logs":[]}`;
		expect(extractResult(stdout, RESULT_MARKER)).toEqual({
			ok: true,
			output: "x",
			error: undefined,
			logs: [],
		});
	});
	it("coerces ok to a boolean and non-array logs to []", () => {
		const stdout = `${RESULT_MARKER}{"ok":1,"logs":"nope"}`;
		const r = extractResult(stdout, RESULT_MARKER);
		expect(r?.ok).toBe(true);
		expect(r?.logs).toEqual([]);
	});
	it("surfaces an error field on a failed run", () => {
		const stdout = `${RESULT_MARKER}{"ok":false,"error":"boom","logs":[]}`;
		expect(extractResult(stdout, RESULT_MARKER)).toEqual({
			ok: false,
			output: undefined,
			error: "boom",
			logs: [],
		});
	});
	it("takes the LAST marker when several are present", () => {
		const stdout = `${RESULT_MARKER}{"ok":false,"logs":[]}\nmid\n${RESULT_MARKER}{"ok":true,"output":"last","logs":[]}\n`;
		const r = extractResult(stdout, RESULT_MARKER);
		expect(r?.ok).toBe(true);
		expect(r?.output).toBe("last");
	});
	it("returns null when the marker is absent", () => {
		expect(extractResult("no marker here\n", RESULT_MARKER)).toBeNull();
	});
	it("returns null when the marked line is not valid JSON", () => {
		expect(
			extractResult(`${RESULT_MARKER}{not json}\n`, RESULT_MARKER),
		).toBeNull();
	});
});
