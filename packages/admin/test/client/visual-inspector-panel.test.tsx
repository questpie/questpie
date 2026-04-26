/**
 * VisualInspectorPanel — body-routing tests
 *
 * The panel is a render-prop router over the active selection.
 * These tests cover:
 *
 *   - the right body fires for each selection kind
 *   - block-field paths are composed (`<blocksPath>._values.<id>.<field>`)
 *   - array-item paths are composed (`<fieldPath>.<index>`)
 *   - the back-to-document button clears non-idle selections
 *   - placeholders render when render-prop slots are omitted
 */

import { describe, expect, it, mock } from "bun:test";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { I18nProvider } from "#questpie/admin/client/i18n/hooks";
import { createSimpleI18n } from "#questpie/admin/client/i18n/simple";
import {
	VisualEditProvider,
	useVisualEdit,
} from "#questpie/admin/client/components/visual-edit/visual-edit-context";
import type { VisualEditSelection } from "#questpie/admin/client/components/visual-edit/types";
import { VisualInspectorPanel } from "#questpie/admin/client/components/visual-edit/visual-inspector-panel";

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

function makeI18n() {
	return createSimpleI18n({
		locale: "en",
		locales: ["en"],
		messages: {
			en: {
				"preview.documentInspector": "Document",
				"preview.blockInspector": "Block",
				"preview.documentPlaceholder":
					"Click anything in the preview to start editing.",
				"preview.backToDocument": "Document",
			},
		},
	});
}

function Wrapper({
	children,
	initialSelection,
}: {
	children: React.ReactNode;
	initialSelection?: VisualEditSelection;
}) {
	const [adapter] = React.useState(makeI18n);
	return (
		<I18nProvider adapter={adapter}>
			<VisualEditProvider initialSelection={initialSelection}>
				{children}
			</VisualEditProvider>
		</I18nProvider>
	);
}

// Tiny effect that calls `select` on mount — used to drive selection
// changes from inside the provider tree.
function SelectOnMount({
	target,
	once,
}: {
	target: VisualEditSelection;
	once?: React.MutableRefObject<boolean>;
}) {
	const { select } = useVisualEdit();
	React.useEffect(() => {
		if (once?.current) return;
		if (once) once.current = true;
		select(target);
	}, [select, target, once]);
	return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VisualInspectorPanel — placeholders (no render-prop slots)", () => {
	it("renders the document placeholder for idle selection", () => {
		render(
			<Wrapper>
				<VisualInspectorPanel />
			</Wrapper>,
		);
		expect(
			screen.getByText(/click anything in the preview/i),
		).toBeTruthy();
		cleanup();
	});

	it("renders a field-path code badge for unknown field selections", () => {
		render(
			<Wrapper
				initialSelection={{ kind: "field", fieldPath: "title" }}
			>
				<VisualInspectorPanel />
			</Wrapper>,
		);
		// Multiple matches for "title" exist (header + placeholder code).
		// The placeholder renders the path inside a <code> element.
		expect(
			screen.getAllByText("title").some((el) => el.tagName === "CODE"),
		).toBe(true);
		cleanup();
	});
});

describe("VisualInspectorPanel — render-prop slots", () => {
	it("calls renderDocument for idle selection", () => {
		const renderDocument = mock(() => (
			<div data-testid="document-body">document content</div>
		));
		render(
			<Wrapper>
				<VisualInspectorPanel renderDocument={renderDocument} />
			</Wrapper>,
		);
		expect(screen.getByTestId("document-body").textContent).toBe(
			"document content",
		);
		expect(renderDocument).toHaveBeenCalled();
		cleanup();
	});

	it("calls renderField with the path for plain field selection", () => {
		const renderField = mock((path: string) => (
			<div data-testid="field">{path}</div>
		));
		render(
			<Wrapper
				initialSelection={{ kind: "field", fieldPath: "slug" }}
			>
				<VisualInspectorPanel renderField={renderField} />
			</Wrapper>,
		);
		expect(screen.getByTestId("field").textContent).toBe("slug");
		expect(renderField).toHaveBeenCalledWith("slug");
		cleanup();
	});

	it("calls renderBlock with blocksPath + blockId for block selection", () => {
		const renderBlock = mock(
			({ blocksPath, blockId }: { blocksPath: string; blockId: string }) => (
				<div data-testid="block">
					{blocksPath}/{blockId}
				</div>
			),
		);
		render(
			<Wrapper
				initialSelection={{
					kind: "block",
					blocksPath: "content",
					blockId: "abc",
				}}
			>
				<VisualInspectorPanel renderBlock={renderBlock} />
			</Wrapper>,
		);
		expect(screen.getByTestId("block").textContent).toBe("content/abc");
		expect(renderBlock).toHaveBeenCalledWith({
			blocksPath: "content",
			blockId: "abc",
		});
		cleanup();
	});

	it("composes the block-field path and routes through renderField", () => {
		const renderField = mock((path: string) => (
			<div data-testid="field">{path}</div>
		));
		render(
			<Wrapper
				initialSelection={{
					kind: "block-field",
					blocksPath: "content",
					blockId: "abc",
					fieldPath: "title",
				}}
			>
				<VisualInspectorPanel renderField={renderField} />
			</Wrapper>,
		);
		expect(screen.getByTestId("field").textContent).toBe(
			"content._values.abc.title",
		);
		cleanup();
	});

	it("calls renderField with the relation path", () => {
		const renderField = mock((path: string) => (
			<div data-testid="field">{path}</div>
		));
		render(
			<Wrapper
				initialSelection={{
					kind: "relation",
					fieldPath: "author",
					targetCollection: "users",
				}}
			>
				<VisualInspectorPanel renderField={renderField} />
			</Wrapper>,
		);
		expect(screen.getByTestId("field").textContent).toBe("author");
		cleanup();
	});

	it("composes the array-item path", () => {
		const renderField = mock((path: string) => (
			<div data-testid="field">{path}</div>
		));
		render(
			<Wrapper
				initialSelection={{
					kind: "array-item",
					fieldPath: "items",
					index: 2,
				}}
			>
				<VisualInspectorPanel renderField={renderField} />
			</Wrapper>,
		);
		expect(screen.getByTestId("field").textContent).toBe("items.2");
		cleanup();
	});
});

describe("VisualInspectorPanel — back-to-document", () => {
	it("does not render the back button while idle", () => {
		render(
			<Wrapper>
				<VisualInspectorPanel />
			</Wrapper>,
		);
		// Default header title is "Document" — but the back button
		// shouldn't be present in idle mode.
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		cleanup();
	});

	it("renders the back button for non-idle selections and clears on click", () => {
		render(
			<Wrapper
				initialSelection={{ kind: "field", fieldPath: "title" }}
			>
				<VisualInspectorPanel
					renderField={(path) => <div data-testid="field">{path}</div>}
					renderDocument={() => (
						<div data-testid="document">document</div>
					)}
				/>
			</Wrapper>,
		);

		expect(screen.getByTestId("field")).toBeTruthy();

		const button = screen.getByRole("button");
		fireEvent.click(button);

		// After clear → idle → renderDocument fires.
		expect(screen.getByTestId("document").textContent).toBe("document");
		cleanup();
	});
});

describe("VisualInspectorPanel — selection changes mid-mount", () => {
	it("re-routes to the new body when select() is called from a child", () => {
		const renderField = mock((path: string) => (
			<div data-testid="field">{path}</div>
		));
		const onceRef: React.MutableRefObject<boolean> = { current: false };

		render(
			<Wrapper>
				<SelectOnMount
					target={{ kind: "field", fieldPath: "slug" }}
					once={onceRef}
				/>
				<VisualInspectorPanel renderField={renderField} />
			</Wrapper>,
		);

		expect(screen.getByTestId("field").textContent).toBe("slug");
		cleanup();
	});
});
