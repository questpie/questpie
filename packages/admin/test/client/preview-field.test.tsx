/**
 * PreviewField + PreviewProvider — public preview component tests.
 *
 * Covers the main click-and-focus surface frontend pages mount
 * inside their preview routes:
 *
 *   - `usePreviewContext()` returns null outside the provider
 *   - `PreviewField` renders bare (no data attributes, no click
 *     handler) when not in preview mode
 *   - In preview mode, `PreviewField` renders with
 *     `data-preview-field`, `data-block-id`, `data-field-type`
 *     attributes plus a click handler that calls back through
 *     the provider's `onFieldClick` with the resolved path
 *   - `PreviewField` integrates with `BlockScopeProvider` to
 *     auto-prefix the field path with `<blocksPath>._values.<id>`
 *   - The optional `onClick` prop overrides the provider callback
 *   - Click handler calls `preventDefault` + `stopPropagation`
 *     so clicking a wrapped link doesn't navigate the iframe
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { BlockScopeProvider } from "#questpie/admin/client/preview/block-scope-context";
import {
	PreviewField,
	PreviewProvider,
	StandalonePreviewField,
	usePreviewContext,
} from "#questpie/admin/client/preview/preview-field";

afterEach(() => {
	cleanup();
});

describe("usePreviewContext — outside provider", () => {
	it("returns null when no provider is mounted", () => {
		const { result } = renderHook(() => usePreviewContext());
		expect(result.current).toBeNull();
	});
});

describe("PreviewField — not in preview mode", () => {
	it("renders the bare component without preview-attribute data", () => {
		const onFieldClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={false}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<PreviewField field="title" as="h1">
					Hello
				</PreviewField>
			</PreviewProvider>,
		);

		const heading = screen.getByText("Hello");
		expect(heading.tagName).toBe("H1");
		// No preview attributes attached when not in preview mode.
		expect(heading.hasAttribute("data-preview-field")).toBe(false);
		expect(heading.hasAttribute("data-field-type")).toBe(false);
	});

	it("does not call onFieldClick on click outside preview mode", () => {
		const onFieldClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={false}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<PreviewField field="title">Hello</PreviewField>
			</PreviewProvider>,
		);

		fireEvent.click(screen.getByText("Hello"));
		expect(onFieldClick).not.toHaveBeenCalled();
	});
});

describe("PreviewField — in preview mode", () => {
	it("attaches data-preview-field and data-field-type attributes", () => {
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={() => {}}
			>
				<PreviewField field="title" fieldType="regular">
					Hello
				</PreviewField>
			</PreviewProvider>,
		);

		const node = screen.getByText("Hello");
		expect(node.getAttribute("data-preview-field")).toBe("title");
		expect(node.getAttribute("data-field-type")).toBe("regular");
	});

	it("calls handleFieldClick with the resolved path on click", () => {
		const onFieldClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<PreviewField field="title">Hello</PreviewField>
			</PreviewProvider>,
		);

		fireEvent.click(screen.getByText("Hello"));
		expect(onFieldClick).toHaveBeenCalledTimes(1);
		const [path, ctx] = onFieldClick.mock.calls[0]!;
		expect(path).toBe("title");
		expect(ctx).toEqual({ blockId: undefined, fieldType: "regular" });
	});

	it("integrates with BlockScopeProvider — composes the scoped path", () => {
		const onFieldClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<BlockScopeProvider blockId="abc" blocksPath="page.body">
					<PreviewField field="title">Hello</PreviewField>
				</BlockScopeProvider>
			</PreviewProvider>,
		);

		const node = screen.getByText("Hello");
		expect(node.getAttribute("data-preview-field")).toBe(
			"page.body._values.abc.title",
		);
		expect(node.getAttribute("data-block-id")).toBe("abc");

		fireEvent.click(node);
		expect(onFieldClick).toHaveBeenCalledTimes(1);
		const [path, ctx] = onFieldClick.mock.calls[0]!;
		expect(path).toBe("page.body._values.abc.title");
		expect(ctx).toEqual({ blockId: "abc", fieldType: "regular" });
	});

	it("forwards fieldType as `relation` to the click handler", () => {
		const onFieldClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<PreviewField field="author" fieldType="relation">
					John
				</PreviewField>
			</PreviewProvider>,
		);

		fireEvent.click(screen.getByText("John"));
		const [, ctx] = onFieldClick.mock.calls[0]!;
		expect(ctx?.fieldType).toBe("relation");
	});

	it("uses the onClick prop when provided instead of the provider callback", () => {
		const providerCallback = mock(() => {});
		const directCallback = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={providerCallback}
			>
				<PreviewField field="title" onClick={directCallback}>
					Hello
				</PreviewField>
			</PreviewProvider>,
		);

		fireEvent.click(screen.getByText("Hello"));
		expect(directCallback).toHaveBeenCalledTimes(1);
		expect(providerCallback).not.toHaveBeenCalled();
	});

	it("prevents default + stops propagation so wrapped links don't navigate", () => {
		// Clicking an editable field in preview should never load a
		// new page inside the iframe — the parent admin owns
		// navigation. Wrap an `<a>` and verify the click handler
		// suppresses both default + propagation.
		const onFieldClick = mock(() => {});
		const outerOnClick = mock(() => {});
		render(
			<PreviewProvider
				isPreviewMode={true}
				focusedField={null}
				onFieldClick={onFieldClick}
			>
				<div onClick={outerOnClick}>
					<PreviewField field="title" as="a">
						Hello
					</PreviewField>
				</div>
			</PreviewProvider>,
		);

		const link = screen.getByText("Hello");
		// `defaultPrevented` is set on the original event when our
		// handler called `preventDefault()`.
		const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(ev);

		expect(ev.defaultPrevented).toBe(true);
		// Outer click never fires because of stopPropagation.
		expect(outerOnClick).not.toHaveBeenCalled();
	});
});

describe("StandalonePreviewField — context-free variant", () => {
	// Same shape as PreviewField but takes isPreviewMode +
	// onFieldClick directly as props. Useful when a consumer can't
	// (or doesn't want to) wrap with `PreviewProvider`.
	it("renders the bare component when not in preview mode", () => {
		render(
			<StandalonePreviewField
				field="title"
				as="h1"
				isPreviewMode={false}
				onFieldClick={() => {}}
			>
				Hello
			</StandalonePreviewField>,
		);
		const heading = screen.getByText("Hello");
		expect(heading.tagName).toBe("H1");
		expect(heading.hasAttribute("data-preview-field")).toBe(false);
	});

	it("attaches preview attributes + click handler in preview mode", () => {
		const onFieldClick = mock(() => {});
		render(
			<StandalonePreviewField
				field="title"
				isPreviewMode={true}
				onFieldClick={onFieldClick}
			>
				Hello
			</StandalonePreviewField>,
		);
		const node = screen.getByText("Hello");
		expect(node.getAttribute("data-preview-field")).toBe("title");
		expect(node.getAttribute("data-field-type")).toBe("regular");

		fireEvent.click(node);
		expect(onFieldClick).toHaveBeenCalledTimes(1);
		const [path, ctx] = onFieldClick.mock.calls[0]!;
		expect(path).toBe("title");
		expect(ctx).toEqual({ blockId: undefined, fieldType: "regular" });
	});

	it("integrates with BlockScopeProvider — composes the scoped path", () => {
		// Even without `PreviewProvider`, the standalone variant
		// still reads `BlockScopeProvider` so frontend pages can
		// compose block-scoped paths consistently across both
		// flavours.
		const onFieldClick = mock(() => {});
		render(
			<BlockScopeProvider blockId="abc" blocksPath="page.body">
				<StandalonePreviewField
					field="title"
					isPreviewMode={true}
					onFieldClick={onFieldClick}
				>
					Hello
				</StandalonePreviewField>
			</BlockScopeProvider>,
		);
		const node = screen.getByText("Hello");
		expect(node.getAttribute("data-preview-field")).toBe(
			"page.body._values.abc.title",
		);
		expect(node.getAttribute("data-block-id")).toBe("abc");

		fireEvent.click(node);
		const [path, ctx] = onFieldClick.mock.calls[0]!;
		expect(path).toBe("page.body._values.abc.title");
		expect(ctx?.blockId).toBe("abc");
	});

	it("prevents default + stops propagation on click", () => {
		const onFieldClick = mock(() => {});
		const outerOnClick = mock(() => {});
		render(
			<div onClick={outerOnClick}>
				<StandalonePreviewField
					field="title"
					as="a"
					isPreviewMode={true}
					onFieldClick={onFieldClick}
				>
					Hello
				</StandalonePreviewField>
			</div>,
		);
		const link = screen.getByText("Hello");
		const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
		link.dispatchEvent(ev);

		expect(ev.defaultPrevented).toBe(true);
		expect(outerOnClick).not.toHaveBeenCalled();
	});
});
