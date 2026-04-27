/**
 * BlockScopeProvider — block-scoped field path resolution tests.
 *
 * Covers the public surface used by frontend `<PreviewField>`
 * consumers to auto-resolve form-field paths under a block:
 *
 *   - `useBlockScope()` returns null outside a provider
 *   - `useResolveFieldPath()` falls through to the bare field name
 *     outside a provider
 *   - Inside a provider, the hook composes the canonical
 *     `${blocksPath}._values.${blockId}.${fieldName}` path through
 *     the `blockValuePath` helper
 *   - The provider accepts the legacy `basePath` (with trailing
 *     `._values`) for backwards compatibility
 *   - Nested providers inherit `blocksPath` from the parent unless
 *     overridden
 */

import { afterEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { cleanup, renderHook } from "@testing-library/react";

import {
	BlockScopeProvider,
	useBlockScope,
	useResolveFieldPath,
} from "#questpie/admin/client/preview/block-scope-context";

afterEach(() => {
	cleanup();
});

describe("useBlockScope — outside provider", () => {
	it("returns null when no provider is mounted", () => {
		const { result } = renderHook(() => useBlockScope());
		expect(result.current).toBeNull();
	});
});

describe("useResolveFieldPath — outside provider", () => {
	it("returns the bare field name when no provider is mounted", () => {
		const { result } = renderHook(() => useResolveFieldPath("title"));
		expect(result.current).toBe("title");
	});

	it("preserves dotted paths verbatim outside a provider", () => {
		const { result } = renderHook(() =>
			useResolveFieldPath("meta.seo.title"),
		);
		expect(result.current).toBe("meta.seo.title");
	});
});

describe("BlockScopeProvider — default blocksPath", () => {
	it("falls back to `content` when neither blocksPath nor basePath is provided", () => {
		const { result } = renderHook(() => useBlockScope(), {
			wrapper: ({ children }: { children: React.ReactNode }) => (
				<BlockScopeProvider blockId="abc">{children}</BlockScopeProvider>
			),
		});
		expect(result.current).toEqual({
			blockId: "abc",
			blocksPath: "content",
			fieldPrefix: "content._values.abc",
		});
	});

	it("uses an explicit blocksPath when provided", () => {
		const { result } = renderHook(() => useBlockScope(), {
			wrapper: ({ children }: { children: React.ReactNode }) => (
				<BlockScopeProvider blockId="abc" blocksPath="page.body">
					{children}
				</BlockScopeProvider>
			),
		});
		expect(result.current).toEqual({
			blockId: "abc",
			blocksPath: "page.body",
			fieldPrefix: "page.body._values.abc",
		});
	});
});

describe("BlockScopeProvider — legacy basePath", () => {
	it("strips the trailing `._values` from a legacy basePath", () => {
		// Older callers passed `basePath="content._values"` literally.
		// The provider recovers `blocksPath="content"` for the new
		// canonical form so `useResolveFieldPath` produces the same
		// output regardless of which prop the caller used.
		const { result } = renderHook(() => useBlockScope(), {
			wrapper: ({ children }: { children: React.ReactNode }) => (
				<BlockScopeProvider blockId="abc" basePath="content._values">
					{children}
				</BlockScopeProvider>
			),
		});
		expect(result.current?.blocksPath).toBe("content");
		expect(result.current?.fieldPrefix).toBe("content._values.abc");
	});

	it("accepts a basePath without the `._values` suffix as-is", () => {
		// If a caller passed `basePath="content"` (no suffix), the
		// provider should not strip anything — treat it as the
		// blocksPath directly.
		const { result } = renderHook(() => useBlockScope(), {
			wrapper: ({ children }: { children: React.ReactNode }) => (
				<BlockScopeProvider blockId="abc" basePath="content">
					{children}
				</BlockScopeProvider>
			),
		});
		expect(result.current?.blocksPath).toBe("content");
	});
});

describe("useResolveFieldPath — inside provider", () => {
	it("composes the canonical scoped path through blockValuePath", () => {
		const { result } = renderHook(() => useResolveFieldPath("title"), {
			wrapper: ({ children }: { children: React.ReactNode }) => (
				<BlockScopeProvider blockId="abc" blocksPath="content">
					{children}
				</BlockScopeProvider>
			),
		});
		expect(result.current).toBe("content._values.abc.title");
	});

	it("composes nested field paths under a non-default blocksPath", () => {
		const { result } = renderHook(
			() => useResolveFieldPath("media.alt"),
			{
				wrapper: ({ children }: { children: React.ReactNode }) => (
					<BlockScopeProvider
						blockId="abc"
						blocksPath="page.body"
					>
						{children}
					</BlockScopeProvider>
				),
			},
		);
		expect(result.current).toBe("page.body._values.abc.media.alt");
	});
});

describe("BlockScopeProvider — nested scopes", () => {
	it("inherits blocksPath from the parent scope when child omits it", () => {
		// `BlockContent` stores values FLAT by block id: nested
		// blocks must NOT compose their parent id into the value
		// path. The provider mirrors that — only `blockId` changes
		// for the inner scope; `blocksPath` is inherited.
		function Parent({ children }: { children: React.ReactNode }) {
			return (
				<BlockScopeProvider blockId="outer" blocksPath="page.body">
					<BlockScopeProvider blockId="inner">
						{children}
					</BlockScopeProvider>
				</BlockScopeProvider>
			);
		}
		const { result } = renderHook(() => useResolveFieldPath("title"), {
			wrapper: Parent,
		});
		expect(result.current).toBe("page.body._values.inner.title");
	});

	it("lets a child override the inherited blocksPath", () => {
		function Parent({ children }: { children: React.ReactNode }) {
			return (
				<BlockScopeProvider blockId="outer" blocksPath="page.body">
					<BlockScopeProvider blockId="inner" blocksPath="other">
						{children}
					</BlockScopeProvider>
				</BlockScopeProvider>
			);
		}
		const { result } = renderHook(() => useBlockScope(), {
			wrapper: Parent,
		});
		expect(result.current?.blocksPath).toBe("other");
	});
});
