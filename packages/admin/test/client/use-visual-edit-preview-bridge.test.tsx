/**
 * useVisualEditPreviewBridge — integration tests
 *
 * Verifies the bridge translates `ResourceFormController`
 * mutation results and `VisualEditSelection` changes into
 * `PreviewPaneRef` calls (`INIT_SNAPSHOT`, `COMMIT`,
 * `FULL_RESYNC`, `SELECT_TARGET`).
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";

import type { PreviewPaneRef } from "#questpie/admin/client/components/preview/preview-pane";
import type { ResourceFormController } from "#questpie/admin/client/views/collection/use-resource-form-controller";
import {
	VisualEditProvider,
	useVisualEdit,
} from "#questpie/admin/client/components/visual-edit/visual-edit-context";
import { useVisualEditPreviewBridge } from "#questpie/admin/client/components/visual-edit/use-visual-edit-preview-bridge";
import type { VisualEditSelection } from "#questpie/admin/client/components/visual-edit/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePreviewRef() {
	const mocks = {
		triggerRefresh: mock(() => {}),
		sendFocusToPreview: mock(() => {}),
		sendInitSnapshot: mock(() => {}),
		sendPatchBatch: mock(() => {}),
		sendCommit: mock(() => {}),
		sendFullResync: mock(() => {}),
		sendSelectTarget: mock(() => {}),
	};
	return {
		current: mocks as unknown as PreviewPaneRef,
		mocks,
	};
}

type FakeMutation<TData = unknown> = {
	isSuccess: boolean;
	data?: TData;
};

type FakeMutations = {
	create: FakeMutation;
	update: FakeMutation;
	remove: FakeMutation;
	restore: FakeMutation;
	revertVersion: FakeMutation;
	transition: FakeMutation;
};

function makeMutations(overrides?: Partial<FakeMutations>): FakeMutations {
	const idle = (): FakeMutation => ({ isSuccess: false, data: undefined });
	return {
		create: idle(),
		update: idle(),
		remove: idle(),
		restore: idle(),
		revertVersion: idle(),
		transition: idle(),
		...overrides,
	};
}

function makeController(opts: {
	transformedItem?: Record<string, unknown> | null | undefined;
	mutations?: Partial<FakeMutations>;
}): ResourceFormController {
	return {
		transformedItem: opts.transformedItem,
		mutations: makeMutations(opts.mutations),
	} as unknown as ResourceFormController;
}

type HarnessProps = {
	controller: ResourceFormController;
	previewRef: { current: PreviewPaneRef | null };
	initialSelection?: VisualEditSelection;
	onSelectExpose?: (
		select: ReturnType<typeof useVisualEdit>["select"],
	) => void;
};

function BridgeProbe({
	controller,
	previewRef,
	onSelectExpose,
}: Omit<HarnessProps, "initialSelection">) {
	useVisualEditPreviewBridge({
		controller,
		previewRef: previewRef as React.RefObject<PreviewPaneRef | null>,
	});
	const { select } = useVisualEdit();
	const onSelectExposeRef = React.useRef(onSelectExpose);
	React.useEffect(() => {
		onSelectExposeRef.current?.(select);
	}, [select]);
	return null;
}

function Harness(props: HarnessProps) {
	return (
		<VisualEditProvider initialSelection={props.initialSelection}>
			<BridgeProbe
				controller={props.controller}
				previewRef={props.previewRef}
				onSelectExpose={props.onSelectExpose}
			/>
		</VisualEditProvider>
	);
}

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVisualEditPreviewBridge — INIT_SNAPSHOT", () => {
	it("seeds the preview when transformedItem is available", () => {
		const previewRef = makePreviewRef();
		const item = { id: "1", title: "Hello" };
		render(
			<Harness
				controller={makeController({ transformedItem: item })}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendInitSnapshot).toHaveBeenCalledTimes(1);
		const [snapshot] = previewRef.mocks.sendInitSnapshot.mock.calls[0]!;
		expect(snapshot).toEqual(item);
	});

	it("does not seed when transformedItem is undefined (create mode)", () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				controller={makeController({ transformedItem: undefined })}
				previewRef={previewRef}
			/>,
		);
		expect(previewRef.mocks.sendInitSnapshot).not.toHaveBeenCalled();
	});

	it("re-seeds when transformedItem reference changes", () => {
		const previewRef = makePreviewRef();
		const first = { id: "1", title: "First" };
		const second = { id: "1", title: "Second" };

		const { rerender } = render(
			<Harness
				controller={makeController({ transformedItem: first })}
				previewRef={previewRef}
			/>,
		);

		rerender(
			<Harness
				controller={makeController({ transformedItem: second })}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendInitSnapshot).toHaveBeenCalledTimes(2);
		const [, secondCall] = previewRef.mocks.sendInitSnapshot.mock.calls;
		expect(secondCall![0]).toEqual(second);
	});
});

describe("useVisualEditPreviewBridge — COMMIT after save", () => {
	it("fires COMMIT when update mutation succeeds", () => {
		const previewRef = makePreviewRef();
		const saved = { id: "1", title: "Saved" };

		const { rerender } = render(
			<Harness
				controller={makeController({
					transformedItem: { id: "1", title: "Old" },
				})}
				previewRef={previewRef}
			/>,
		);

		rerender(
			<Harness
				controller={makeController({
					transformedItem: { id: "1", title: "Old" },
					mutations: { update: { isSuccess: true, data: saved } },
				})}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendCommit).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.sendCommit.mock.calls[0]![0]).toEqual(saved);
	});

	it("does not fire COMMIT twice for the same successful data reference", () => {
		const previewRef = makePreviewRef();
		const saved = { id: "1", title: "Saved" };

		const { rerender } = render(
			<Harness
				controller={makeController({
					transformedItem: { id: "1", title: "Old" },
					mutations: { update: { isSuccess: true, data: saved } },
				})}
				previewRef={previewRef}
			/>,
		);

		// Re-render with the SAME data reference — bridge should
		// skip the duplicate commit via its internal lastSeenRef.
		rerender(
			<Harness
				controller={makeController({
					transformedItem: { id: "1", title: "Old" },
					mutations: { update: { isSuccess: true, data: saved } },
				})}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendCommit).toHaveBeenCalledTimes(1);
	});

	it("fires COMMIT when create mutation succeeds", () => {
		const previewRef = makePreviewRef();
		const created = { id: "1", title: "Created" };

		const { rerender } = render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);

		rerender(
			<Harness
				controller={makeController({
					mutations: { create: { isSuccess: true, data: created } },
				})}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendCommit).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.sendCommit.mock.calls[0]![0]).toEqual(created);
	});
});

describe("useVisualEditPreviewBridge — FULL_RESYNC after side effects", () => {
	it("fires FULL_RESYNC when delete succeeds", () => {
		const previewRef = makePreviewRef();
		const { rerender } = render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);
		rerender(
			<Harness
				controller={makeController({
					mutations: { remove: { isSuccess: true } },
				})}
				previewRef={previewRef}
			/>,
		);
		expect(previewRef.mocks.sendFullResync).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.sendFullResync.mock.calls[0]![0]).toBe("manual");
	});

	it("fires FULL_RESYNC when restore succeeds (reason=revert)", () => {
		const previewRef = makePreviewRef();
		const { rerender } = render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);
		rerender(
			<Harness
				controller={makeController({
					mutations: { restore: { isSuccess: true } },
				})}
				previewRef={previewRef}
			/>,
		);
		expect(previewRef.mocks.sendFullResync.mock.calls[0]![0]).toBe("revert");
	});

	it("fires FULL_RESYNC when revertVersion succeeds (reason=revert)", () => {
		const previewRef = makePreviewRef();
		const { rerender } = render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);
		rerender(
			<Harness
				controller={makeController({
					mutations: { revertVersion: { isSuccess: true } },
				})}
				previewRef={previewRef}
			/>,
		);
		expect(previewRef.mocks.sendFullResync.mock.calls[0]![0]).toBe("revert");
	});

	it("fires FULL_RESYNC when stage transition succeeds (reason=stage-switch)", () => {
		const previewRef = makePreviewRef();
		const { rerender } = render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);
		rerender(
			<Harness
				controller={makeController({
					mutations: { transition: { isSuccess: true } },
				})}
				previewRef={previewRef}
			/>,
		);
		expect(previewRef.mocks.sendFullResync.mock.calls[0]![0]).toBe(
			"stage-switch",
		);
	});

	it("fires the resync only once per success transition", () => {
		const previewRef = makePreviewRef();
		const idle = makeController({});
		const success = makeController({
			mutations: { remove: { isSuccess: true } },
		});

		const { rerender } = render(
			<Harness controller={idle} previewRef={previewRef} />,
		);
		rerender(<Harness controller={success} previewRef={previewRef} />);
		// Re-render with the same success state — should not re-fire.
		rerender(<Harness controller={success} previewRef={previewRef} />);

		expect(previewRef.mocks.sendFullResync).toHaveBeenCalledTimes(1);
	});
});

describe("useVisualEditPreviewBridge — SELECT_TARGET forwarding", () => {
	it("fires SELECT_TARGET on initial mount with idle path", () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
			/>,
		);

		expect(previewRef.mocks.sendSelectTarget).toHaveBeenCalled();
		const [path, extras] =
			previewRef.mocks.sendSelectTarget.mock.calls[0]!;
		expect(path).toBeNull();
		expect(extras).toEqual({ kind: "idle" });
	});

	it("fires SELECT_TARGET when selection changes", () => {
		const previewRef = makePreviewRef();
		let selectFn:
			| ReturnType<typeof useVisualEdit>["select"]
			| undefined;
		render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
				onSelectExpose={(select) => {
					selectFn = select;
				}}
			/>,
		);

		// Initial mount fired SELECT_TARGET once with idle.
		const initialCalls = previewRef.mocks.sendSelectTarget.mock.calls.length;

		act(() => {
			selectFn!({ kind: "field", fieldPath: "title" });
		});

		const calls = previewRef.mocks.sendSelectTarget.mock.calls;
		expect(calls.length).toBeGreaterThan(initialCalls);
		const [path, extras] = calls[calls.length - 1]!;
		expect(path).toBe("title");
		expect(extras).toEqual({ kind: "field" });
	});

	it("forwards block context (blockId) for block-field selections", () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				controller={makeController({})}
				previewRef={previewRef}
				initialSelection={{
					kind: "block-field",
					blocksPath: "content",
					blockId: "abc",
					fieldPath: "title",
				}}
			/>,
		);

		const calls = previewRef.mocks.sendSelectTarget.mock.calls;
		const [path, extras] = calls[calls.length - 1]!;
		expect(path).toBe("content._values.abc.title");
		expect(extras).toEqual({ kind: "block-field", blockId: "abc" });
	});
});
