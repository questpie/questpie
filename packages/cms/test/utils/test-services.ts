import type { QueueClient } from "#questpie/cms/server/integrated/queue/index.js";
import type { Disk } from "flydrive";
import type { MailerService } from "#questpie/cms/server/integrated/mailer";
import type { LoggerService } from "#questpie/cms/server/integrated/logger";

/**
 * Mock Queue Service for testing
 */
export const createMockQueue = (): QueueClient<any> & {
	__jobs: Array<{ name: string; payload: any; options?: any }>;
} => {
	const jobs: Array<{ name: string; payload: any; options?: any }> = [];

	return {
		__jobs: jobs,
		publish: async (name: string, payload: any, options?: any) => {
			jobs.push({ name, payload, options });
			return { id: crypto.randomUUID() } as any;
		},
	} as any;
};

/**
 * Mock Storage Service for testing
 */
export const createMockStorage = (): Disk & {
	__files: Map<string, { content: Buffer; metadata: any }>;
} => {
	const files = new Map<string, { content: Buffer; metadata: any }>();

	return {
		__files: files,
		put: async (key: string, content: Buffer | string, options?: any) => {
			files.set(key, {
				content: Buffer.isBuffer(content) ? content : Buffer.from(content),
				metadata: options,
			});
			return {
				key,
				url: `https://mock-storage.test/${key}`,
			} as any;
		},
		get: async (key: string) => {
			const file = files.get(key);
			if (!file) throw new Error(`File not found: ${key}`);
			return file.content as any;
		},
		delete: async (key: string) => {
			files.delete(key);
		},
		exists: async (key: string) => {
			return files.has(key);
		},
		url: (key: string) => {
			return `https://mock-storage.test/${key}`;
		},
	} as any;
};

/**
 * Mock Email Service for testing
 */
export const createMockEmail = (): MailerService & {
	__sent: Array<{ to: string; subject: string; html?: string; text?: string }>;
} => {
	const sent: Array<{ to: string; subject: string; html?: string; text?: string }> =
		[];

	return {
		__sent: sent,
		send: async (options: any) => {
			sent.push({
				to: options.to,
				subject: options.subject,
				html: options.html,
				text: options.text,
			});
			return { messageId: crypto.randomUUID() } as any;
		},
	} as any;
};

/**
 * Mock Logger Service for testing
 */
export const createMockLogger = (): LoggerService & {
	__logs: Array<{ level: string; message: string; data?: any }>;
} => {
	const logs: Array<{ level: string; message: string; data?: any }> = [];

	const logFn = (level: string) => (message: string, data?: any) => {
		logs.push({ level, message, data });
	};

	return {
		__logs: logs,
		info: logFn("info"),
		warn: logFn("warn"),
		error: logFn("error"),
		debug: logFn("debug"),
		child: () => createMockLogger(),
	} as any;
};

/**
 * Mock Auth Service for testing
 */
export const createMockAuth = () => {
	return {
		api: {
			getSession: async () => null,
		},
	} as any;
};

/**
 * Create all mock services at once
 */
export const createMockServices = () => {
	return {
		queue: createMockQueue(),
		storage: createMockStorage(),
		email: createMockEmail(),
		logger: createMockLogger(),
		auth: createMockAuth(),
	};
};
