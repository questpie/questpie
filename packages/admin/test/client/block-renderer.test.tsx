/**
 * BlockRenderer — frontend block tree renderer.
 *
 * Tests the public component frontend pages mount to render
 * block content from the API:
 *
 *   - Returns null on empty content / empty tree
 *   - Looks up renderers by exact type, then kebab→camel fallback
 *   - Warns + returns null when no renderer matches
 *   - Recursively renders children for layout blocks
 *   - Wraps each block in `<BlockScopeProvider>` with the correct
 *     `blocksPath` so nested `<PreviewField>` components compose
 *     scoped paths correctly
 *   - Editor-mode handlers (`onBlockClick`, `selectedBlockId`)
 *     attach a clickable wrapper with `data-block-id` /
 *     `data-block-type` attributes
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";

import { BlockRenderer } from "#questpie/admin/client/blocks/block-renderer";
import {
	useBlockScope,
	useResolveFieldPath,
} from "#questpie/admin/client/preview/block-scope-context";
import type {
	BlockContent,
	BlockNode,
} from "#questpie/admin/client/blocks/types";

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(
	id: string,
	type: string,
	children: BlockNode[] = [],
): BlockNode {
	return { id, type, children };
}

const EMPTY_CONTENT: BlockContent = { _tree: [], _values: {} };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlockRenderer — empty state", () => {
	it("returns null when content has an empty tree", () => {
		const { container } = render(
			<BlockRenderer content={EMPTY_CONTENT} renderers={{}} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("returns null when content is undefined", () => {
		const { container } = render(
			<BlockRenderer
				// @ts-expect-error — testing the defensive fallback
				content={undefined}
				renderers={{}}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});

describe("BlockRenderer — renderer lookup", () => {
	it("looks up the renderer by exact block type", () => {
		const Hero = mock(({ values }: { values: Record<string, unknown> }) => (
			<div data-testid="hero-out">{String(values.title)}</div>
		));
		render(
			<BlockRenderer
				content={{
					_tree: [makeNode("a", "hero")],
					_values: { a: { title: "Hi" } },
				}}
				renderers={{ hero: Hero }}
			/>,
		);
		expect(screen.getByTestId("hero-out").textContent).toBe("Hi");
	});

	it("falls back to kebab→camel when the exact key misses", () => {
		// Block type from the API arrives as kebab-case (`team-grid`),
		// but the consumer's renderers map is keyed by camelCase
		// (`teamGrid`). The renderer should still resolve.
		const TeamGrid = mock(() => <div data-testid="team-out">team</div>);
		render(
			<BlockRenderer
				content={{
					_tree: [makeNode("a", "team-grid")],
					_values: { a: {} },
				}}
				renderers={{ teamGrid: TeamGrid }}
			/>,
		);
		expect(screen.getByTestId("team-out").textContent).toBe("team");
	});

	it("warns and renders null when no renderer matches", () => {
		const originalWarn = console.warn;
		const warn = mock(() => {});
		console.warn = warn;
		try {
			const { container } = render(
				<BlockRenderer
					content={{
						_tree: [makeNode("a", "unknown")],
						_values: { a: {} },
					}}
					renderers={{}}
				/>,
			);
			// BlockRenderer bails before constructing the wrapper —
			// the outer container has the `<div>` for the
			// `_tree.map(renderBlock)` result but the unknown block
			// produces no `data-block-id` element of its own.
			expect(container.querySelector("[data-block-id='a']")).toBeNull();
			// The warn fired with the missing-renderer message.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]![0])).toContain(
				"No renderer found",
			);
		} finally {
			console.warn = originalWarn;
		}
	});
});

describe("BlockRenderer — children & data", () => {
	it("renders nested children for layout blocks", () => {
		const Layout = mock(
			({ children }: { children?: React.ReactNode }) => (
				<section data-testid="layout">{children}</section>
			),
		);
		const Leaf = mock(() => <div data-testid="leaf">leaf</div>);

		render(
			<BlockRenderer
				content={{
					_tree: [makeNode("a", "layout", [makeNode("b", "leaf")])],
					_values: { a: {}, b: {} },
				}}
				renderers={{ layout: Layout, leaf: Leaf }}
			/>,
		);

		expect(screen.getByTestId("layout")).toBeDefined();
		expect(screen.getByTestId("leaf")).toBeDefined();
	});

	it("forwards prefetched data per block id when provided", () => {
		const Capture = mock(
			({ data }: { data?: Record<string, unknown> }) => (
				<div data-testid="data">{String(data?.greeting ?? "missing")}</div>
			),
		);
		render(
			<BlockRenderer
				content={{ _tree: [makeNode("a", "capture")], _values: { a: {} } }}
				renderers={{ capture: Capture }}
				data={{ a: { greeting: "hi" } }}
			/>,
		);
		expect(screen.getByTestId("data").textContent).toBe("hi");
	});
});

describe("BlockRenderer — block scope integration", () => {
	function ScopeProbe() {
		const scope = useBlockScope();
		const path = useResolveFieldPath("title");
		return (
			<div
				data-testid="scope-probe"
				data-block-id={scope?.blockId ?? ""}
				data-blocks-path={scope?.blocksPath ?? ""}
				data-resolved={path}
			/>
		);
	}

	it("wraps each block in BlockScopeProvider with the default blocksPath", () => {
		render(
			<BlockRenderer
				content={{ _tree: [makeNode("abc", "scope")], _values: { abc: {} } }}
				renderers={{ scope: ScopeProbe }}
			/>,
		);
		const probe = screen.getByTestId("scope-probe");
		expect(probe.getAttribute("data-block-id")).toBe("abc");
		expect(probe.getAttribute("data-blocks-path")).toBe("content");
		// `useResolveFieldPath("title")` should compose to the full
		// scoped path through `blockValuePath`.
		expect(probe.getAttribute("data-resolved")).toBe(
			"content._values.abc.title",
		);
	});

	it("passes a custom blocksPath through to the scope provider", () => {
		render(
			<BlockRenderer
				content={{ _tree: [makeNode("abc", "scope")], _values: { abc: {} } }}
				renderers={{ scope: ScopeProbe }}
				blocksPath="page.body"
			/>,
		);
		const probe = screen.getByTestId("scope-probe");
		expect(probe.getAttribute("data-blocks-path")).toBe("page.body");
		expect(probe.getAttribute("data-resolved")).toBe(
			"page.body._values.abc.title",
		);
	});
});

describe("BlockRenderer — editor mode click wrapper", () => {
	it("attaches data-block-id + data-block-type wrappers with onBlockClick", () => {
		const Leaf = () => <div data-testid="leaf">leaf</div>;
		const onBlockClick = mock(() => {});
		const { container } = render(
			<BlockRenderer
				content={{ _tree: [makeNode("abc", "leaf")], _values: { abc: {} } }}
				renderers={{ leaf: Leaf }}
				onBlockClick={onBlockClick}
			/>,
		);
		const wrapper = container.querySelector("[data-block-id='abc']");
		expect(wrapper).not.toBeNull();
		expect(wrapper!.getAttribute("data-block-type")).toBe("leaf");
		// Clicking the wrapper fires onBlockClick + stopPropagation.
		fireEvent.click(wrapper!);
		expect(onBlockClick).toHaveBeenCalledTimes(1);
		expect(onBlockClick.mock.calls[0]![0]).toBe("abc");
	});

	it("does not add an interactive wrapper when onBlockClick is omitted", () => {
		// Without a click handler, BlockRenderer still wraps in a
		// non-interactive `<div>` for the data attributes — but no
		// `role="button"` / `tabIndex` and no `cursor-pointer` class.
		const Leaf = () => <div data-testid="leaf">leaf</div>;
		const { container } = render(
			<BlockRenderer
				content={{ _tree: [makeNode("abc", "leaf")], _values: { abc: {} } }}
				renderers={{ leaf: Leaf }}
			/>,
		);
		const wrapper = container.querySelector("[data-block-id='abc']");
		expect(wrapper).not.toBeNull();
		expect(wrapper!.getAttribute("role")).toBeNull();
		expect(wrapper!.hasAttribute("tabIndex")).toBe(false);
	});
});
