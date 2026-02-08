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
export const loginPage = page("login", {
  component: () => import("../../views/pages/login-page"),
  showInNav: false,
}).path("/login");

/**
 * Forgot password page - request password reset email
 */
export const forgotPasswordPage = page("forgot-password", {
  component: () => import("../../views/pages/forgot-password-page"),
  showInNav: false,
}).path("/forgot-password");

/**
 * Reset password page - set new password with token
 */
export const resetPasswordPage = page("reset-password", {
  component: () => import("../../views/pages/reset-password-page"),
  showInNav: false,
}).path("/reset-password");

/**
 * Setup page - create first admin account
 */
export const setupPage = page("setup", {
  component: () => import("../../views/pages/setup-page"),
  showInNav: false,
}).path("/setup");

// ============================================================================
// Dashboard Page
// ============================================================================

/**
 * Dashboard page - main admin dashboard (already added as hardcoded item in buildNavigation)
 */
export const dashboardPage = page("dashboard", {
  component: () => import("../../views/pages/dashboard-page"),
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
export const authPages = {
  login: loginPage,
  forgotPassword: forgotPasswordPage,
  resetPassword: resetPasswordPage,
  setup: setupPage,
} as const;
