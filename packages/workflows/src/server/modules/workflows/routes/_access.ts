import type { RouteAccessContext, RouteAccessRule } from "questpie";

import {
	defaultWorkflowAccess,
	resolveWorkflowsConfig,
	type WorkflowAccessOperation,
	type WorkflowsAccessConfig,
	type WorkflowsConfigInput,
	type WorkflowsConfigState,
} from "../../../config.js";

type WorkflowConfigState = {
	state?: WorkflowsConfigState;
};

function isAccessConfig(value: unknown): value is WorkflowsAccessConfig {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isManageOperation(operation: WorkflowAccessOperation): boolean {
	return (
		operation === "cancel" || operation === "retry" || operation === "sendEvent"
	);
}

function resolveWorkflowAccessRule(
	config: WorkflowsConfigInput | undefined,
	operation: WorkflowAccessOperation,
): RouteAccessRule {
	const access = config?.access;
	if (access === undefined) return defaultWorkflowAccess;
	if (!isAccessConfig(access)) return access;

	const exactRule = access[operation];
	if (exactRule !== undefined) return exactRule;
	if (isManageOperation(operation) && access.manage !== undefined) {
		return access.manage;
	}
	return access.default ?? defaultWorkflowAccess;
}

async function evaluateAccessRule(
	rule: RouteAccessRule,
	ctx: RouteAccessContext,
): Promise<boolean> {
	if (typeof rule === "boolean") return rule;
	return rule(ctx);
}

export function workflowRouteAccess(
	operation: WorkflowAccessOperation,
): RouteAccessRule {
	return async (ctx) => {
		const app = (ctx as { app?: WorkflowConfigState }).app;
		const config = resolveWorkflowsConfig(app?.state);
		const rule = resolveWorkflowAccessRule(config, operation);
		return evaluateAccessRule(rule, ctx);
	};
}
