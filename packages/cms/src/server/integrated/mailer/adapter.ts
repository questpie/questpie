import type { SerializableMailOptions } from "./types";

/**
 * Abstract base class for mail adapters
 */
export abstract class MailAdapter {
	abstract send(options: SerializableMailOptions): Promise<void>;
}
