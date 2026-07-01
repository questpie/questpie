/**
 * AUTOPILOT_SINGLE_MODEL — the harness-in-worker consolidation cutover flag.
 *
 * The wire change (the run_links stream tail / chat re-point, T6/T7) and the FE
 * rewrite (T9) land behind this ONE flag, flipped atomically at T9, so no commit
 * ships a "new wire / old parser" chat to humans. OFF by default until T9.
 */
export function isSingleModel(): boolean {
	return process.env.AUTOPILOT_SINGLE_MODEL === "true";
}
