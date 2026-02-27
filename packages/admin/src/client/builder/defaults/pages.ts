/**
 * Built-in Pages
 *
 * Default page definitions for the admin UI.
 * Includes auth flow pages and dashboard.
 */

import { page } from "../page/page";

// ============================================================================
// Auth Pages
// ============================================================================

/**
 * Login page - email/password authentication
 */
const loginPage = page("login", {
	component: async () => ({ default: (await import("../../views/pages/login-page")).LoginPage }),
	showInNav: false,
}).path("/login");

/**
 * Forgot password page - request password reset email
 */
const forgotPasswordPage = page("forgot-password", {
	component: async () => ({ default: (await import("../../views/pages/forgot-password-page")).ForgotPasswordPage }),
	showInNav: false,
}).path("/forgot-password");

/**
 * Reset password page - set new password with token
 */
const resetPasswordPage = page("reset-password", {
	component: async () => ({ default: (await import("../../views/pages/reset-password-page")).ResetPasswordPage }),
	showInNav: false,
}).path("/reset-password");

/**
 * Setup page - create first admin account
 */
const setupPage = page("setup", {
	component: async () => ({ default: (await import("../../views/pages/setup-page")).SetupPage }),
	showInNav: false,
}).path("/setup");

// ============================================================================
// Dashboard Page
// ============================================================================

/**
 * Dashboard page - main admin dashboard (already added as hardcoded item in buildNavigation)
 */
const dashboardPage = page("dashboard", {
	component: async () => ({ default: (await import("../../views/pages/dashboard-page")).DashboardPage }),
	showInNav: false,
}).path("/");

// ============================================================================
// Export All Built-in Pages
// ============================================================================

/**
 * All built-in pages as a record for use with AdminBuilder.pages()
 */
export const builtInPages = {
	login: loginPage,
	forgotPassword: forgotPasswordPage,
	resetPassword: resetPasswordPage,
	setup: setupPage,
	dashboard: dashboardPage,
} as const;

/**
 * Auth-only pages (without dashboard)
 * Includes setup page for first-time admin creation
 */
const authPages = {
	login: loginPage,
	forgotPassword: forgotPasswordPage,
	resetPassword: resetPasswordPage,
	setup: setupPage,
} as const;
