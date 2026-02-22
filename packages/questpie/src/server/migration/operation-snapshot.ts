import type { generateDrizzleJson } from "drizzle-kit/api-postgres";
import type { OperationSnapshot, SnapshotOperation } from "./types.js";

// Infer snapshot type from drizzle-kit API
type DrizzleSnapshotJSON = Awaited<ReturnType<typeof generateDrizzleJson>>;

/**
 * Manages operation-based snapshots for intelligent migration tracking
 *
 * Instead of storing full schema snapshots, we store only the operations (set/remove)
 * that changed between snapshots. This enables:
 * - Better change detection (additions, modifications, removals)
 * - Smart deduplication of redundant operations
 * - Cleaner migration history
 *
 * Works with Drizzle Kit beta's DDL array format
 */
export class OperationSnapshotManager {
	/**
	 * Generate operations by comparing two snapshots
	 * Works with beta API's ddl array structure
	 */
	generateOperations(
		oldSnapshot: DrizzleSnapshotJSON,
		newSnapshot: DrizzleSnapshotJSON,
		migrationId: string,
	): SnapshotOperation[] {
		const operations: SnapshotOperation[] = [];
		const timestamp = new Date().toISOString();

		const oldDdl = oldSnapshot.ddl || [];
		const newDdl = newSnapshot.ddl || [];

		// Create maps for easy lookup by entity key
		const oldDdlMap = new Map<string, any>();
		for (const entity of oldDdl) {
			const key = this.getEntityKey(entity);
			oldDdlMap.set(key, entity);
		}

		const newDdlMap = new Map<string, any>();
		for (const entity of newDdl) {
			const key = this.getEntityKey(entity);
			newDdlMap.set(key, entity);
		}

		// Check for removed entities
		for (const [key, oldEntity] of oldDdlMap) {
			if (!newDdlMap.has(key)) {
				operations.push({
					type: "remove",
					path: `ddl.${this.encodeKey(key)}`,
					timestamp,
					migrationId,
				});
			}
		}

		// Check for added or modified entities
		for (const [key, newEntity] of newDdlMap) {
			const currentPath = `ddl.${this.encodeKey(key)}`;

			if (!oldDdlMap.has(key)) {
				// New entity
				operations.push({
					type: "set",
					path: currentPath,
					value: newEntity,
					timestamp,
					migrationId,
				});
			} else {
				const oldEntity = oldDdlMap.get(key);
				// Compare entity properties
				if (!this.deepEqual(oldEntity, newEntity)) {
					operations.push({
						type: "set",
						path: currentPath,
						value: newEntity,
						timestamp,
						migrationId,
					});
				}
			}
		}

		return operations;
	}

	/**
	 * Get unique key for a DDL entity
	 * Combines entityType with identifying fields
	 */
	private getEntityKey(entity: any): string {
		const type = entity.entityType;
		const schema = entity.schema || "public";

		switch (type) {
			case "tables":
				return `table:${schema}.${entity.name}`;
			case "columns":
				return `column:${schema}.${entity.table}.${entity.name}`;
			case "pks":
				return `pk:${schema}.${entity.table}.${entity.name}`;
			case "fks":
				return `fk:${schema}.${entity.table}.${entity.name}`;
			case "indexes":
				return `index:${schema}.${entity.table}.${entity.name}`;
			case "enums":
				return `enum:${schema}.${entity.name}`;
			case "schemas":
				return `schema:${entity.name}`;
			case "sequences":
				return `sequence:${schema}.${entity.name}`;
			case "policies":
				return `policy:${schema}.${entity.table}.${entity.name}`;
			case "roles":
				return `role:${entity.name}`;
			case "views":
				return `view:${schema}.${entity.name}`;
			case "uniqueConstraints":
				return `unique:${schema}.${entity.table}.${entity.name}`;
			case "checkConstraints":
				return `check:${schema}.${entity.table}.${entity.name}`;
			default:
				// Fallback for unknown entity types
				return `${type}:${JSON.stringify(entity)}`;
		}
	}

	/**
	 * Build a snapshot from a series of operations
	 */
	buildSnapshotFromOperations(
		operations: SnapshotOperation[],
		baseSnapshot?: DrizzleSnapshotJSON,
	): DrizzleSnapshotJSON {
		const snapshot: DrizzleSnapshotJSON =
			baseSnapshot || this.getDefaultSnapshot();

		// Sort operations by timestamp to ensure correct order
		const sortedOperations = operations.sort((a, b) =>
			a.timestamp.localeCompare(b.timestamp),
		);

		// Build ddl map from operations
		const ddlMap = new Map<string, any>();

		// Start with base snapshot's ddl
		if (snapshot.ddl) {
			for (const entity of snapshot.ddl) {
				const key = this.getEntityKey(entity);
				ddlMap.set(key, entity);
			}
		}

		// Apply operations
		for (const operation of sortedOperations) {
			if (operation.path.startsWith("ddl.")) {
				const key = this.decodeKey(operation.path.substring(4)); // Remove "ddl." prefix

				if (operation.type === "set") {
					ddlMap.set(key, operation.value);
				} else if (operation.type === "remove") {
					ddlMap.delete(key);
				}
			}
		}

		// Convert map back to array
		snapshot.ddl = Array.from(ddlMap.values());

		return snapshot;
	}

	/**
	 * Deduplicate operations (remove redundant operations)
	 */
	deduplicateOperations(operations: SnapshotOperation[]): SnapshotOperation[] {
		const operationMap = new Map<string, SnapshotOperation>();

		// Sort by timestamp to process in order
		const sortedOperations = operations.sort((a, b) =>
			a.timestamp.localeCompare(b.timestamp),
		);

		for (const operation of sortedOperations) {
			const key = operation.path;
			const existingOperation = operationMap.get(key);

			if (!existingOperation) {
				operationMap.set(key, operation);
			} else if (operation.type === "remove") {
				// Remove operation always wins
				operationMap.set(key, operation);
			} else if (
				operation.type === "set" &&
				existingOperation.type === "remove"
			) {
				// Set after remove - keep the set
				operationMap.set(key, operation);
			} else if (operation.type === "set" && existingOperation.type === "set") {
				// Later set operation wins
				operationMap.set(key, operation);
			}
		}

		return Array.from(operationMap.values()).sort((a, b) =>
			a.timestamp.localeCompare(b.timestamp),
		);
	}

	private deepEqual(a: any, b: any): boolean {
		try {
			// Use a more robust deep equality check
			return (
				JSON.stringify(this.normalizeObject(a)) ===
				JSON.stringify(this.normalizeObject(b))
			);
		} catch {
			return false;
		}
	}

	/**
	 * Normalize object structure to ensure consistent comparison
	 * Sorts object keys and handles arrays consistently
	 */
	private normalizeObject(obj: any): any {
		if (obj === null || obj === undefined) {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this.normalizeObject(item));
		}

		if (typeof obj === "object") {
			const normalized: any = {};
			const sortedKeys = Object.keys(obj).sort();
			for (const key of sortedKeys) {
				normalized[key] = this.normalizeObject(obj[key]);
			}
			return normalized;
		}

		return obj;
	}

	/**
	 * Encode dots in key names to avoid conflicts with path separators
	 * Replaces '.' with '__DOT__' in key names
	 */
	private encodeKey(key: string): string {
		return key.replace(/\./g, "__DOT__").replace(/:/g, "__COLON__");
	}

	/**
	 * Decode dots in key names back to original form
	 * Replaces '__DOT__' with '.' in key names
	 */
	private decodeKey(key: string): string {
		return key.replace(/__DOT__/g, ".").replace(/__COLON__/g, ":");
	}

	private getDefaultSnapshot(): DrizzleSnapshotJSON {
		return {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres",
			prevIds: [],
			version: "8",
			ddl: [],
			renames: [],
		} as DrizzleSnapshotJSON;
	}
}
