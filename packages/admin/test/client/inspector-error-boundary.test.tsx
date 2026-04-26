/**
 * InspectorErrorBoundary — DOM smoke test
 *
 * First component test in the admin package. Verifies the
 * preload-based DOM setup works end-to-end (`@testing-library/react`
 * + happy-dom + bun:test) before more component tests follow.
 */

import { describe, expect, it, mock } from "bun:test";
import * as React from "react";
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";

import { InspectorErrorBoundary } from "#questpie/admin/client/components/visual-edit/inspector-error-boundary";

function Throws({ message }: { message: string }): never {
	throw new Error(message);
}

function Safe({ text }: { text: string }) {
	return <span data-testid="safe">{text}</span>;
}

describe("InspectorErrorBoundary", () => {
	it("renders children when nothing throws", () => {
		render(
			<InspectorErrorBoundary>
				<Safe text="hello" />
			</InspectorErrorBoundary>,
		);
		expect(screen.getByTestId("safe").textContent).toBe("hello");
		cleanup();
	});

	it("catches a thrown error and renders the fallback", () => {
		// Suppress the noisy React error log during the throw —
		// it's expected here.
		const originalError = console.error;
		console.error = () => {};
		try {
			render(
				<InspectorErrorBoundary>
					<Throws message="boom" />
				</InspectorErrorBoundary>,
			);
			// Default fallback message + the thrown error's message both render.
			expect(
				screen.getByText(/Something went wrong rendering this field/i),
			).toBeTruthy();
			expect(screen.getByText("boom")).toBeTruthy();
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("invokes onError once with the caught error", () => {
		const onError = mock(() => {});
		const originalError = console.error;
		console.error = () => {};
		try {
			render(
				<InspectorErrorBoundary onError={onError}>
					<Throws message="boom" />
				</InspectorErrorBoundary>,
			);
			expect(onError).toHaveBeenCalledTimes(1);
			const [err] = onError.mock.calls[0]!;
			expect((err as Error).message).toBe("boom");
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("retry button clears the error state", () => {
		// We test the retry path by rendering, swapping the child
		// to a non-throwing component, then clicking Try again.
		// Re-rendering with the same throwing child would just
		// re-throw, which we already covered above.
		const originalError = console.error;
		console.error = () => {};
		try {
			const { rerender } = render(
				<InspectorErrorBoundary>
					<Throws message="boom" />
				</InspectorErrorBoundary>,
			);

			expect(
				screen.queryByText(/Something went wrong/i),
			).toBeTruthy();

			// Swap the child first, then click retry — the boundary
			// resets its `error` state and renders the new child.
			rerender(
				<InspectorErrorBoundary>
					<Safe text="recovered" />
				</InspectorErrorBoundary>,
			);

			fireEvent.click(screen.getByRole("button", { name: /try again/i }));

			expect(screen.getByTestId("safe").textContent).toBe("recovered");
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("resets automatically when resetKey changes", () => {
		const originalError = console.error;
		console.error = () => {};
		try {
			const { rerender } = render(
				<InspectorErrorBoundary resetKey="a">
					<Throws message="boom" />
				</InspectorErrorBoundary>,
			);
			expect(
				screen.queryByText(/Something went wrong/i),
			).toBeTruthy();

			rerender(
				<InspectorErrorBoundary resetKey="b">
					<Safe text="b-content" />
				</InspectorErrorBoundary>,
			);

			expect(screen.getByTestId("safe").textContent).toBe("b-content");
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("falls back to a custom fallback render prop when supplied", () => {
		const originalError = console.error;
		console.error = () => {};
		try {
			render(
				<InspectorErrorBoundary
					fallback={({ error }) => (
						<div data-testid="custom">custom: {error.message}</div>
					)}
				>
					<Throws message="x" />
				</InspectorErrorBoundary>,
			);
			expect(screen.getByTestId("custom").textContent).toBe("custom: x");
		} finally {
			console.error = originalError;
			cleanup();
		}
	});
});
