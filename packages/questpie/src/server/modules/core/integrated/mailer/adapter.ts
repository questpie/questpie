import type { SerializableMailOptions } from "./types.js";

/**
 * Abstract base class for mail adapters
 */
export abstract class MailAdapter {
	abstract send(options: SerializableMailOptions): Promise<void>;
}
