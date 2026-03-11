/**
 * Module-scoped app reference.
 *
 * Set by `initWorkflows(app)`, read by the replay engine and job handlers.
 * This avoids passing the full Questpie instance through the flat job context
 * while keeping the replay engine decoupled from the Questpie class.
 */

let _app: any = null;

/** Store the app reference. Called by initWorkflows(). */
export function setAppRef(app: any): void {
	_app = app;
}

/** Get the stored app reference. Throws if not initialized. */
export function getAppRef(): any {
	if (!_app) {
		throw new Error(
			"@questpie/workflows: App not initialized. Call initWorkflows(app) after createApp().",
		);
	}
	return _app;
}
