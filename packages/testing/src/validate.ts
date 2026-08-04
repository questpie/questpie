/**
 * Internal. Not exported from the package entry.
 *
 * Every bound in this package is a positive number of milliseconds, lines or
 * characters, and a zero passed by accident turns a bound into an immediate
 * failure that reads like a hang. Rejecting it at the edge names the option
 * that was wrong.
 */
export function positive(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive number`);
	}
	return value;
}
