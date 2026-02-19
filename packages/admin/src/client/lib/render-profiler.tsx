import * as React from "react";

export type RenderProfilerProps = {
	id: string;
	children: React.ReactNode;
	minDurationMs?: number;
};

const LOG_MIN_INTERVAL_MS = 800;
const lastLogAtById = new Map<string, number>();

export function RenderProfiler({
	id,
	children,
	minDurationMs = 8,
}: RenderProfilerProps) {
	const onRender = React.useCallback<React.ProfilerOnRenderCallback>(
		(
			_profileId,
			phase,
			actualDuration,
			baseDuration,
			startTime,
			commitTime,
		) => {
			if (actualDuration < minDurationMs) {
				return;
			}

			const now = commitTime || globalThis.performance?.now?.() || Date.now();
			const lastLogAt = lastLogAtById.get(id) ?? 0;

			if (now - lastLogAt < LOG_MIN_INTERVAL_MS) {
				return;
			}

			lastLogAtById.set(id, now);
			console.debug(
				`[RenderProfiler] ${id} phase=${phase} actual=${actualDuration.toFixed(1)}ms base=${baseDuration.toFixed(1)}ms start=${startTime.toFixed(1)}ms commit=${commitTime.toFixed(1)}ms`,
			);
		},
		[id, minDurationMs],
	);

	if (process.env.NODE_ENV !== "development") {
		return <>{children}</>;
	}

	return (
		<React.Profiler id={id} onRender={onRender}>
			{children}
		</React.Profiler>
	);
}
