export interface SessionStorageAdapter {
	pull(key: string, localPath: string): Promise<void>;
	push(localPath: string, key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
	list(prefix: string): Promise<string[]>;
	delete(key: string): Promise<void>;
}
