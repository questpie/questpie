/**
 * Test Helpers for Admin Tests
 *
 * Provides mock components, field definitions, and view definitions
 * for testing plain object factory functionality.
 */

import type * as React from "react";

import { field } from "#questpie/admin/client/builder/field/field";
import { page } from "#questpie/admin/client/builder/page/page";
import { view } from "#questpie/admin/client/builder/view/view";
import { widget } from "#questpie/admin/client/builder/widget/widget";

// ============================================================================
// Mock Components
// ============================================================================

export const MockTextField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	maxLength?: number;
}> = () => null;

export const MockTextareaField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	rows?: number;
	maxLength?: number;
}> = () => null;

export const MockEmailField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
}> = () => null;

export const MockNumberField: React.FC<{
	name: string;
	value?: number;
	onChange?: (value: number) => void;
	min?: number;
	max?: number;
}> = () => null;

export const MockSelectField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	options: { label: string; value: string }[];
}> = () => null;

export const MockRelationField: React.FC<{
	name: string;
	value?: string | string[];
	onChange?: (value: string | string[]) => void;
	targetCollection: string;
	multiple?: boolean;
}> = () => null;

export const MockTextCell: React.FC<{ value: string }> = () => null;
export const MockTableView: React.FC<{ columns: string[] }> = () => null;
export const MockFormView: React.FC<{ sections: any[] }> = () => null;
export const MockStatsWidget: React.FC<{ title: string }> = () => null;
export const MockDashboardPage: React.FC = () => null;
export const MockIcon: React.FC = () => null;

// ============================================================================
// Test Field Definitions (plain frozen objects)
// ============================================================================

export function createTextField() {
	return field("text", {
		component: MockTextField,
		cell: MockTextCell,
	});
}

export function createTextareaField() {
	return field("textarea", {
		component: MockTextareaField,
	});
}

export function createEmailField() {
	return field("email", {
		component: MockEmailField,
		cell: MockTextCell,
	});
}

export function createNumberField() {
	return field("number", {
		component: MockNumberField,
	});
}

export function createSelectField() {
	return field("select", {
		component: MockSelectField,
	});
}

export function createRelationField() {
	return field("relation", {
		component: MockRelationField,
	});
}

// ============================================================================
// Test View Definitions (plain frozen objects)
// ============================================================================

export function createTableView() {
	return view("table", {
		kind: "list",
		component: MockTableView,
	});
}

export function createFormView() {
	return view("form", {
		kind: "form",
		component: MockFormView,
	});
}

// ============================================================================
// Test Widget Definitions
// ============================================================================

export function createStatsWidget() {
	return widget("stats", {
		component: MockStatsWidget,
	});
}

// ============================================================================
// Test Page Definitions
// ============================================================================

export function createDashboardPage() {
	return page("dashboard", {
		component: MockDashboardPage,
		path: "/",
	});
}

// ============================================================================
// Pre-built Test Registries
// ============================================================================

export function createTestFieldRegistry() {
	return {
		text: createTextField(),
		textarea: createTextareaField(),
		email: createEmailField(),
		number: createNumberField(),
		select: createSelectField(),
		relation: createRelationField(),
	};
}

export function createTestViewRegistry() {
	return {
		table: createTableView(),
		form: createFormView(),
	};
}

export function createTestModuleState() {
	return {
		"~app": undefined as any,
		fields: createTestFieldRegistry(),
		views: {
			table: createTableView(),
			form: createFormView(),
		},
		widgets: {
			stats: createStatsWidget(),
		},
		pages: {
			dashboard: createDashboardPage(),
		},
		components: {},
		blocks: {} as Record<string, never>,
		translations: {},
		locale: { default: "en", supported: ["en"] },
	};
}
