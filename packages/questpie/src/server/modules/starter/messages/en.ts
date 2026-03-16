/**
 * Core backend messages (English).
 * Default translations for all built-in error messages and system messages.
 *
 * Exports only the English locale object (flat key-value map),
 * NOT the locale-wrapped `{ en: { ... } }` — codegen wraps it
 * in `messages: { en: <this> }` so it must be the inner object.
 */
import { coreBackendMessages } from "../_messages.js";

export default coreBackendMessages.en;
