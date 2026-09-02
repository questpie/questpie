export function runtimeMonotonicNow(): number {
	return performance.timeOrigin + performance.now();
}
