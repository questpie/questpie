import { describe, expect, it } from "bun:test";

import { buildOutlineRows } from "../../../src/client/views/collection/outline";

const docs = [
	{
		id: "a",
		title: "A",
		status: "backlog",
		project: { id: "p1", title: "Alpha" },
		path: "docs/a.md",
	},
	{
		id: "b",
		title: "B",
		status: "backlog",
		project: { id: "p1", title: "Alpha" },
		path: "docs/guides/b.md",
	},
	{
		id: "c",
		title: "C",
		status: "done",
		project: { id: "p2", title: "Beta" },
		path: "notes/c.md",
	},
] as Array<Record<string, unknown>>;

describe("outline row builder", () => {
	it("groups rows by field", () => {
		const rows = buildOutlineRows({
			docs,
			outline: {
				levels: [
					{ kind: "field", field: "status", order: ["backlog", "done"] },
				],
			},
		});

		expect(
			rows.map((row) => [row.kind, row.label ?? row.id, row.depth]),
		).toEqual([
			["group", "backlog", 0],
			["record", "a", 1],
			["record", "b", 1],
			["group", "done", 0],
			["record", "c", 1],
		]);
	});

	it("groups rows by relation field", () => {
		const rows = buildOutlineRows({
			docs,
			outline: {
				levels: [{ kind: "relation-field", relation: "project" }],
			},
		});

		expect(
			rows.filter((row) => row.kind === "group").map((row) => row.label),
		).toEqual(["Alpha", "Beta"]);
	});

	it("builds recursive edge trees and avoids cycles", () => {
		const rows = buildOutlineRows({
			docs,
			edgesByCollection: {
				task_relations: [
					{ sourceTask: "a", targetTask: "b", relationType: "parent_of" },
					{ sourceTask: "b", targetTask: "c", relationType: "parent_of" },
					{ sourceTask: "c", targetTask: "a", relationType: "parent_of" },
					{ sourceTask: "a", targetTask: "b", relationType: "parent_of" },
				],
			},
			outline: {
				levels: [
					{
						kind: "edge",
						collection: "task_relations",
						parentField: "sourceTask",
						childField: "targetTask",
						where: { relationType: "parent_of" },
						repeat: { maxDepth: 8 },
					},
				],
			},
		});

		expect(
			rows.filter((row) => row.kind === "record").map((row) => row.id),
		).toEqual(["a", "b", "c"]);
	});

	it("preserves edge ancestors for matching child rows", () => {
		const rows = buildOutlineRows({
			docs: [{ id: "c", title: "C" }],
			edgesByCollection: {
				task_relations: [
					{
						sourceTask: { id: "a", title: "A" },
						targetTask: { id: "b", title: "B" },
						relationType: "parent_of",
					},
					{
						sourceTask: { id: "b", title: "B" },
						targetTask: { id: "c", title: "C" },
						relationType: "parent_of",
					},
				],
			},
			outline: {
				levels: [
					{
						kind: "edge",
						collection: "task_relations",
						parentField: "sourceTask",
						childField: "targetTask",
						where: { relationType: "parent_of" },
						repeat: true,
					},
				],
			},
		});

		expect(
			rows.filter((row) => row.kind === "record").map((row) => row.id),
		).toEqual(["a", "b", "c"]);
	});

	it("can render edge matches without preserving missing ancestors", () => {
		const rows = buildOutlineRows({
			docs: [{ id: "c", title: "C" }],
			edgesByCollection: {
				task_relations: [
					{
						sourceTask: { id: "b", title: "B" },
						targetTask: { id: "c", title: "C" },
						relationType: "parent_of",
					},
				],
			},
			outline: {
				preserveMatchingBranches: false,
				levels: [
					{
						kind: "edge",
						collection: "task_relations",
						parentField: "sourceTask",
						childField: "targetTask",
						where: { relationType: "parent_of" },
						repeat: true,
					},
				],
			},
		});

		expect(
			rows.filter((row) => row.kind === "record").map((row) => row.id),
		).toEqual(["c"]);
	});

	it("builds synthetic path folders", () => {
		const rows = buildOutlineRows({
			docs,
			outline: {
				levels: [
					{
						kind: "path",
						field: "path",
						separator: "/",
						syntheticFolders: true,
						repeat: true,
					},
				],
			},
		});

		expect(
			rows.map((row) => [row.kind, row.label ?? row.id, row.depth]),
		).toEqual([
			["synthetic", "docs", 0],
			["synthetic", "guides", 1],
			["record", "b", 2],
			["record", "a", 1],
			["synthetic", "notes", 0],
			["record", "c", 1],
		]);
	});

	it("scopes row keys under parent groups", () => {
		const rows = buildOutlineRows({
			docs: [
				{
					id: "a",
					scopeType: "project",
					project: { id: "p1", title: "Alpha" },
					path: "docs/a.md",
				},
				{
					id: "b",
					scopeType: "task",
					project: { id: "p1", title: "Alpha" },
					path: "docs/b.md",
				},
			],
			outline: {
				levels: [
					{ kind: "field", field: "scopeType" },
					{ kind: "relation-field", relation: "project" },
					{
						kind: "path",
						field: "path",
						separator: "/",
						syntheticFolders: true,
						repeat: true,
					},
				],
			},
		});

		const keys = rows.map((row) => row.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
