/**
 * useFormToPreviewPatcher — integration tests
 *
 * Drives the patcher with a real react-hook-form instance and a
 * mocked `PreviewPaneRef` so we can assert on the exact ladder
 * of `sendPatchBatch` / `triggerRefresh` calls produced by form
 * changes.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";

import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import type { PreviewPaneRef } from "#questpie/admin/client/components/preview/preview-pane";
import { useFormToPreviewPatcher } from "#questpie/admin/client/components/visual-edit/use-form-to-preview-patcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldInstance(
	name: string,
	options: Record<string, unknown> = {},
): FieldInstance {
	return Object.freeze({
		name,
		component: () => null,
		"~options": options,
	}) as unknown as FieldInstance;
}

function makePreviewRef(): {
	current: PreviewPaneRef;
	mocks: {
		triggerRefresh: ReturnType<typeof mock>;
		sendFocusToPreview: ReturnType<typeof mock>;
		sendInitSnapshot: ReturnType<typeof mock>;
		sendPatchBatch: ReturnType<typeof mock>;
		sendCommit: ReturnType<typeof mock>;
		sendFullResync: ReturnType<typeof mock>;
		sendSelectTarget: ReturnType<typeof mock>;
		sendNavigatePreview: ReturnType<typeof mock>;
	};
} {
	const mocks = {
		triggerRefresh: mock(() => {}),
		sendFocusToPreview: mock(() => {}),
		sendInitSnapshot: mock(() => {}),
		sendPatchBatch: mock(() => {}),
		sendCommit: mock(() => {}),
		sendFullResync: mock(() => {}),
		sendSelectTarget: mock(() => {}),
		sendNavigatePreview: mock(() => {}),
	};
	return {
		current: mocks as unknown as PreviewPaneRef,
		mocks,
	};
}

type HarnessProps = {
	defaultValues: Record<string, unknown>;
	fields: Record<string, FieldInstance>;
	previewRef: { current: PreviewPaneRef | null };
	baseline?: Record<string, unknown> | undefined;
	debounceMs?: number;
	disabled?: boolean;
	onForm: (form: UseFormReturn<any>) => void;
};

function PatcherUser({
	previewRef,
	fields,
	baseline,
	debounceMs,
	disabled,
}: Omit<HarnessProps, "defaultValues" | "onForm">) {
	useFormToPreviewPatcher({
		previewRef: previewRef as React.RefObject<PreviewPaneRef | null>,
		fields,
		schema: undefined,
		baseline,
		debounceMs,
		disabled,
	});
	return null;
}

function Harness(props: HarnessProps) {
	const form = useForm({ defaultValues: props.defaultValues });
	const onFormRef = React.useRef(props.onForm);
	React.useEffect(() => {
		onFormRef.current(form);
		// only on mount — form is stable across renders for our purposes
		// oxlint-disable-next-line react/exhaustive-deps
	}, [form]);
	return (
		<FormProvider {...form}>
			<PatcherUser
				previewRef={props.previewRef}
				fields={props.fields}
				baseline={props.baseline ?? props.defaultValues}
				debounceMs={props.debounceMs ?? 5}
				disabled={props.disabled}
			/>
		</FormProvider>
	);
}

async function flushDebounce(ms = 20) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFormToPreviewPatcher — single field changes", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("emits a single set op when a scalar field changes", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "Old" }}
				fields={{ title: fieldInstance("text") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "New");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [seq, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(seq).toBe(1);
		expect(ops).toEqual([{ op: "set", path: "title", value: "New" }]);
	});

	it("does not emit when the form value matches the baseline", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "Same" }}
				fields={{ title: fieldInstance("text") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "Same");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).not.toHaveBeenCalled();
	});

	it("monotonically increases seq across batches", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "A", description: "x" }}
				fields={{
					title: fieldInstance("text"),
					description: fieldInstance("textarea"),
				}}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "B");
			await flushDebounce();
		});
		await act(async () => {
			formRef.setValue("description", "y");
			await flushDebounce();
		});

		const calls = previewRef.mocks.sendPatchBatch.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0]![0]).toBe(1);
		expect(calls[1]![0]).toBe(2);
	});
});

describe("useFormToPreviewPatcher — debouncing + batching", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("coalesces multiple changes inside one debounce window into one batch", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "A", description: "x" }}
				fields={{
					title: fieldInstance("text"),
					description: fieldInstance("textarea"),
				}}
				previewRef={previewRef}
				debounceMs={20}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "B");
			formRef.setValue("description", "y");
			await flushDebounce(40);
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([
			{ op: "set", path: "title", value: "B" },
			{ op: "set", path: "description", value: "y" },
		]);
	});
});

describe("useFormToPreviewPatcher — strategy buckets", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("triggers refresh (not patch) for relation-typed field changes", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ author: "u1" }}
				fields={{ author: fieldInstance("relation") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("author", "u2");
			await flushDebounce();
		});

		expect(previewRef.mocks.triggerRefresh).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.sendPatchBatch).not.toHaveBeenCalled();
	});

	it("splits a mixed batch — patch ops for scalars, refresh for relations", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "A", author: "u1" }}
				fields={{
					title: fieldInstance("text"),
					author: fieldInstance("relation"),
				}}
				previewRef={previewRef}
				debounceMs={20}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "B");
			formRef.setValue("author", "u2");
			await flushDebounce(40);
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.triggerRefresh).toHaveBeenCalledTimes(1);
		const [, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([{ op: "set", path: "title", value: "B" }]);
	});

	it("ignores fields with deferred patch strategy", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ note: "old" }}
				fields={{
					note: fieldInstance("text", {
						admin: { visualEdit: { patchStrategy: "deferred" } },
					}),
				}}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("note", "new");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).not.toHaveBeenCalled();
		expect(previewRef.mocks.triggerRefresh).not.toHaveBeenCalled();
	});
});

describe("useFormToPreviewPatcher — disabled flag", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("does not subscribe when disabled is true", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "Old" }}
				fields={{ title: fieldInstance("text") }}
				previewRef={previewRef}
				debounceMs={5}
				disabled
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("title", "New");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).not.toHaveBeenCalled();
	});

	it("re-subscribes when disabled flips back to false", async () => {
		// Pin the disabled-flip recovery: a workspace that toggles
		// the patcher off (e.g., during a long-running save) must
		// recover the live-edit flow when disabled clears. Without
		// the test, a future memoisation refactor could pin the
		// subscription identity and miss the re-subscribe.
		const previewRef = makePreviewRef();
		const fields = { title: fieldInstance("text") };

		const { rerender } = render(
			<Harness
				defaultValues={{ title: "Old" }}
				fields={fields}
				previewRef={previewRef}
				debounceMs={5}
				disabled
				onForm={onForm}
			/>,
		);

		// Sanity check: patcher is silent while disabled.
		await act(async () => {
			formRef.setValue("title", "Mid");
			await flushDebounce();
		});
		expect(previewRef.mocks.sendPatchBatch).not.toHaveBeenCalled();

		// Flip disabled back to false.
		rerender(
			<Harness
				defaultValues={{ title: "Old" }}
				fields={fields}
				previewRef={previewRef}
				debounceMs={5}
				disabled={false}
				onForm={onForm}
			/>,
		);

		// Now the next change should produce a patch.
		await act(async () => {
			formRef.setValue("title", "New");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([{ op: "set", path: "title", value: "New" }]);
	});
});

describe("useFormToPreviewPatcher — nested objects", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("emits a deep set op for nested object changes (recursive diff)", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ meta: { seo: { title: "Old", desc: "D" } } }}
				fields={{ meta: fieldInstance("object") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("meta.seo.title", "New");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([{ op: "set", path: "meta.seo.title", value: "New" }]);
	});

	it("keeps emitting patches for repeated nested object edits", async () => {
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ meta: { seo: { title: "A", desc: "D" } } }}
				fields={{ meta: fieldInstance("object") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("meta.seo.title", "B");
			await flushDebounce();
		});
		await act(async () => {
			formRef.setValue("meta.seo.title", "C");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(2);
		expect(previewRef.mocks.sendPatchBatch.mock.calls[0]?.[1]).toEqual([
			{ op: "set", path: "meta.seo.title", value: "B" },
		]);
		expect(previewRef.mocks.sendPatchBatch.mock.calls[1]?.[1]).toEqual([
			{ op: "set", path: "meta.seo.title", value: "C" },
		]);
	});
});

describe("useFormToPreviewPatcher — baseline reset (post-COMMIT)", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("resets the snapshot + seq when baseline changes mid-edit", async () => {
		const previewRef = makePreviewRef();
		const fields = {
			title: fieldInstance("text"),
			description: fieldInstance("textarea"),
		};

		const { rerender } = render(
			<Harness
				defaultValues={{ title: "A" }}
				fields={fields}
				previewRef={previewRef}
				baseline={{ title: "A" }}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		// First edit produces seq=1, set title=B against baseline A.
		await act(async () => {
			formRef.setValue("title", "B");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		expect(previewRef.mocks.sendPatchBatch.mock.calls[0]![0]).toBe(1);

		// Simulate post-COMMIT refetch: a new baseline arrives carrying
		// the saved title plus a brand-new field. The patcher should
		// reset its internal snapshot + seq to 0; the next form change
		// emits seq=1 again, diffed against the new baseline.
		rerender(
			<Harness
				defaultValues={{ title: "A" }}
				fields={fields}
				previewRef={previewRef}
				baseline={{ title: "B", description: "old" }}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			formRef.setValue("description", "new");
			await flushDebounce();
		});

		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(2);
		const [seq, ops] = previewRef.mocks.sendPatchBatch.mock.calls[1]!;
		// seq resets after baseline change.
		expect(seq).toBe(1);
		// Diff is computed against the NEW baseline — only the
		// description change is emitted, not a stale title=B op.
		expect(ops).toEqual([{ op: "set", path: "description", value: "new" }]);
	});
});

describe("useFormToPreviewPatcher — defensive guards", () => {
	let formRef: UseFormReturn<any>;
	const onForm = (form: UseFormReturn<any>) => {
		formRef = form;
	};

	it("is a no-op when previewRef.current is null at flush time", async () => {
		// Simulates the workspace tearing down mid-debounce — the
		// preview pane's ref unmounts and goes null while a patch is
		// still pending. The flush should bail without throwing.
		const previewRef: { current: PreviewPaneRef | null } = {
			current: null,
		};
		render(
			<Harness
				defaultValues={{ title: "Old" }}
				fields={{ title: fieldInstance("text") }}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		// The form change runs, the debounce timer fires, the flush
		// reads `previewRef.current` (null), bails. No throw, no
		// patch sent. The next render with a real ref should also
		// not retroactively flush — patches are not buffered on the
		// admin side.
		await act(async () => {
			formRef.setValue("title", "New");
			await flushDebounce();
		});

		// Promote ref to a real one mid-test; subsequent changes
		// should now produce ops, but the previously-flushed change
		// is permanently lost (admin-side buffering is the
		// PreviewPane's job, not the patcher's).
		const real = makePreviewRef();
		previewRef.current = real.current;

		await act(async () => {
			formRef.setValue("title", "Newer");
			await flushDebounce();
		});

		expect(real.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [, ops] = real.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([{ op: "set", path: "title", value: "Newer" }]);
	});

	it("drops underscore-prefixed top-level keys (form internals)", async () => {
		// react-hook-form (and our own form-state machinery) reserves
		// `_`-prefixed top-level paths for internal bookkeeping. The
		// patcher MUST NOT mirror those into the iframe's draft —
		// they're meaningless on the iframe side and could carry
		// unsanitised internal state.
		const previewRef = makePreviewRef();
		render(
			<Harness
				defaultValues={{ title: "Old", _internal: "x" }}
				fields={{
					title: fieldInstance("text"),
					_internal: fieldInstance("text"),
				}}
				previewRef={previewRef}
				debounceMs={5}
				onForm={onForm}
			/>,
		);

		await act(async () => {
			// Mutate both keys in the same debounce window.
			formRef.setValue("title", "New");
			formRef.setValue("_internal", "leaked");
			await flushDebounce();
		});

		// Patches the visible field; silently drops `_internal`.
		expect(previewRef.mocks.sendPatchBatch).toHaveBeenCalledTimes(1);
		const [, ops] = previewRef.mocks.sendPatchBatch.mock.calls[0]!;
		expect(ops).toEqual([{ op: "set", path: "title", value: "New" }]);
	});
});
