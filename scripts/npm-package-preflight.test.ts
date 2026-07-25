import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	assertPackagesRegistered,
	findUnregisteredPackages,
	isNpmNotFoundError,
	npmViewMatchesPackage,
	npmViewMatchesVersion,
} from "./npm-package-preflight";

describe("npm package release preflight", () => {
	test("collects every unregistered package before publishing starts", async () => {
		const registered = new Set(["questpie"]);

		await expect(
			findUnregisteredPackages(
				["questpie", "@questpie/tanstack-db", "@questpie/crdt-yjs"],
				async (name) => registered.has(name),
			),
		).resolves.toEqual(["@questpie/crdt-yjs", "@questpie/tanstack-db"]);
	});

	test("fails closed with actionable bootstrap instructions", async () => {
		await expect(
			assertPackagesRegistered(
				["questpie", "@questpie/tanstack-db"],
				async (name) => name === "questpie",
			),
		).rejects.toThrow(
			"Bootstrap these packages with a maintainer token, configure their trusted publisher",
		);
	});

	test("allows a release when every package is registered", async () => {
		await expect(
			assertPackagesRegistered(
				["questpie", "@questpie/admin"],
				async () => true,
			),
		).resolves.toBeUndefined();
	});

	test("propagates registry failures instead of treating them as an absent package", async () => {
		const outage = new Error("registry unavailable");
		await expect(
			findUnregisteredPackages(["questpie"], async () => {
				throw outage;
			}),
		).rejects.toBe(outage);
	});

	test("requires npm view to return the requested package name", () => {
		expect(npmViewMatchesPackage('"questpie"\n', "questpie")).toBe(true);
		expect(npmViewMatchesPackage('"other-package"\n', "questpie")).toBe(false);
		expect(() => npmViewMatchesPackage("not-json", "questpie")).toThrow();
	});

	test("requires npm view to return the requested package version", () => {
		expect(npmViewMatchesVersion('"3.17.0"\n', "3.17.0")).toBe(true);
		expect(npmViewMatchesVersion('"3.16.0"\n', "3.17.0")).toBe(false);
		expect(() => npmViewMatchesVersion("not-json", "3.17.0")).toThrow();
	});

	test("does not misclassify registry outages as an absent package", async () => {
		expect(
			isNpmNotFoundError({
				stderr: "npm error code E503\nnpm error Service Unavailable",
			}),
		).toBe(false);
		expect(
			isNpmNotFoundError({
				stderr: "npm error code E404\nnpm error 404 Not Found",
			}),
		).toBe(true);
	});

	test("runs package and version preflights before deleting the previous release summary", () => {
		const source = readFileSync(
			new URL("./publish.ts", import.meta.url),
			"utf8",
		);
		const summaryDeletion = source.indexOf("fs.rmSync(PUBLISH_SUMMARY_PATH");
		expect(
			source.indexOf("await assertPackagesRegistered(packages.keys())"),
		).toBeLessThan(summaryDeletion);
		expect(
			source.indexOf("await isNpmPackageVersionPublished(name, pkg.version)"),
		).toBeLessThan(summaryDeletion);
	});
});
