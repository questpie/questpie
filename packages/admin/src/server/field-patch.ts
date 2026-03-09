/**
 * Field Builder — Admin Augmentation (Runtime Patch)
 *
 * Adds `.admin()` method to the Field class via prototype patching.
 * Type declarations are in `@questpie/admin/augmentation.ts`.
 *
 * This file must be imported (side-effect) from `@questpie/admin/server`
 * to ensure the method is available before collection definitions run.
 *
 * @internal
 */

/**
 * Field Builder — Admin Augmentation (Runtime Patch)
 *
 * The `.admin()` method type is declared directly on the Field class.
 * This file patches the prototype with the admin-aware implementation.
 *
 * @internal
 */

import { Field } from "questpie";

/**
 * Runtime implementation of `.admin()` on Field.
 * Creates a new Field with the admin config stored in state.
 */
Field.prototype.admin = function admin(opts: unknown) {
	return new Field({ ...this._state, admin: opts });
};
