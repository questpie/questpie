/**
 * Test Helpers for Admin Builder Tests
 *
 * Provides mock components, field definitions, and view definitions
 * for testing builder functionality.
 */

import type * as React from "react";
import { field } from "#questpie/admin/client/builder/field/field";
import { page } from "#questpie/admin/client/builder/page/page";
import { editView, listView } from "#questpie/admin/client/builder/view/view";
import { widget } from "#questpie/admin/client/builder/widget/widget";

// ============================================================================
// Mock Components
// ============================================================================

/**
 * Mock field component for testing
 */
export const MockTextField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	maxLength?: number;
}> = () => null;

/**
 * Mock field component with more options
 */
export const MockTextareaField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	rows?: number;
	maxLength?: number;
}> = () => null;

/**
 * Mock email field component
 */
export const MockEmailField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
}> = () => null;

/**
 * Mock number field component
 */
export const MockNumberField: React.FC<{
	name: string;
	value?: number;
	onChange?: (value: number) => void;
	min?: number;
	max?: number;
}> = () => null;

/**
 * Mock select field component
 */
export const MockSelectField: React.FC<{
	name: string;
	value?: string;
	onChange?: (value: string) => void;
	options: { label: string; value: string }[];
}> = () => null;

/**
 * Mock relation field component
 */
export const MockRelationField: React.FC<{
	name: string;
	value?: string | string[];
	onChange?: (value: string | string[]) => void;
	targetCollection: string;
	multiple?: boolean;
}> = () => null;

/**
 * Mock cell component for table views
 */
export const MockTextCell: React.FC<{ value: string }> = () => null;

/**
 * Mock list view component
 */
export const MockTableView: React.FC<{ columns: string[] }> = () => null;

/**
 * Mock edit view component
 */
export const MockFormView: React.FC<{ sections: any[] }> = () => null;

/**
 * Mock widget component
 */
export const MockStatsWidget: React.FC<{ title: string }> = () => null;

/**
 * Mock page component
 */
export const MockDashboardPage: React.FC = () => null;

/**
 * Mock icon component
 */
export const MockIcon: React.FC = () => null;

// ============================================================================
// Test Field Definitions
// ============================================================================

/**
 * Create test text field definition
 */
export function createTextField() {
	return field("text", {
		component: MockTextField,
		cell: MockTextCell,
		config: {} as { maxLength?: number },
	});
}

/**
 * Create test textarea field definition
 */
export function createTextareaField() {
	return field("textarea", {
		component: MockTextareaField,
		config: {} as { rows?: number; maxLength?: number },
	});
}

/**
 * Create test email field definition
 */
export function createEmailField() {
	return field("email", {
		component: MockEmailField,
		cell: MockTextCell,
	});
}

/**
 * Create test number field definition
 */
export function createNumberField() {
	return field("number", {
		component: MockNumberField,
		config: {} as { min?: number; max?: number },
	});
}

/**
 * Create test select field definition
 */
export function createSelectField() {
	return field("select", {
		component: MockSelectField,
		config: {} as { options: { label: string; value: string }[] },
	});
}

/**
 * Create test relation field definition
 */
export function createRelationField() {
	return field("relation", {
		component: MockRelationField,
		config: {} as { targetCollection: string; multiple?: boolean },
	});
}

// ============================================================================
// Test View Definitions
// ============================================================================

/**
 * Create test table view (list view)
 */
export function createTableView() {
	return listView("table", {
		component: MockTableView,
	});
}

/**
 * Create test form view (edit view)
 */
export function createFormView() {
	return editView("form", {
		component: MockFormView,
	});
}

// ============================================================================
// Test Widget Definitions
// ============================================================================

/**
 * Create test stats widget
 */
export function createStatsWidget() {
	return widget("stats", {
		component: MockStatsWidget,
	});
}

// ============================================================================
// Test Page Definitions
// ============================================================================

/**
 * Create test dashboard page
 */
export function createDashboardPage() {
	return page("dashboard", {
		component: MockDashboardPage,
	});
}

// ============================================================================
// Pre-built Test Modules
// ============================================================================

/**
 * Create a test field registry with common fields
 */
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

/**
 * Create a test view registry with common views
 */
export function createTestViewRegistry() {
	return {
		table: createTableView(),
		form: createFormView(),
	};
}

/**
 * Create a complete test admin module state
 */
export function createTestModuleState() {
	return {
		fields: createTestFieldRegistry(),
		listViews: {
			table: createTableView(),
		},
		editViews: {
			form: createFormView(),
		},
		widgets: {
			stats: createStatsWidget(),
		},
		pages: {
			dashboard: createDashboardPage(),
		},
		collections: {},
		globals: {},
		dashboard: { layout: "grid" as const, widgets: [] },
		sidebar: { sections: [] },
		branding: {},
		locale: { default: "en", supported: ["en"] },
		defaultViews: {},
	};
}
