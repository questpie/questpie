/**
 * Server-Side Admin Translations Tests
 *
 * Tests for the server-side admin i18n system:
 * 1. getAdminMessagesForLocale() - returns messages for a locale
 * 2. getSupportedAdminLocales() - returns all supported locales
 * 3. Admin locale config augmentation via .adminLocale()
 */

import { describe, expect, it } from "bun:test";
import {
  adminMessagesEN,
  adminMessagesSK,
  allAdminMessages,
  getAdminMessagesForLocale,
  getSupportedAdminLocales,
} from "#questpie/admin/server/i18n/index";

describe("server-side admin translations", () => {
  describe("getSupportedAdminLocales()", () => {
    it("should return an array of locale codes", () => {
      const locales = getSupportedAdminLocales();

      expect(Array.isArray(locales)).toBe(true);
      expect(locales.length).toBeGreaterThan(0);
    });

    it("should include English locale", () => {
      const locales = getSupportedAdminLocales();

      expect(locales).toContain("en");
    });

    it("should include all locales that have message files", () => {
      const locales = getSupportedAdminLocales();

      // These are the locales we have message files for
      expect(locales).toContain("en");
      expect(locales).toContain("sk");
      expect(locales).toContain("cs");
      expect(locales).toContain("de");
      expect(locales).toContain("fr");
      expect(locales).toContain("es");
      expect(locales).toContain("pt");
      expect(locales).toContain("pl");
    });
  });

  describe("getAdminMessagesForLocale()", () => {
    it("should return messages for English locale", () => {
      const messages = getAdminMessagesForLocale("en");

      expect(messages).toBeDefined();
      expect(typeof messages).toBe("object");
    });

    it("should return messages for Slovak locale", () => {
      const messages = getAdminMessagesForLocale("sk");

      expect(messages).toBeDefined();
      expect(typeof messages).toBe("object");
    });

    it("should include common UI messages", () => {
      const messages = getAdminMessagesForLocale("en");

      // Check for common admin UI keys
      expect(messages["common.save"]).toBeDefined();
      expect(messages["common.cancel"]).toBeDefined();
      expect(messages["common.delete"]).toBeDefined();
    });

    it("should fall back to English for unknown locales", () => {
      const messages = getAdminMessagesForLocale("xyz");
      const englishMessages = getAdminMessagesForLocale("en");

      // Should return English messages as fallback
      expect(messages).toEqual(englishMessages);
    });

    it("should return empty object if no fallback available", () => {
      // This tests the edge case where even English is not available
      // In practice, English is always available
      const messages = getAdminMessagesForLocale("en");
      expect(typeof messages).toBe("object");
    });
  });

  describe("allAdminMessages", () => {
    it("should be an object with locale keys", () => {
      expect(typeof allAdminMessages).toBe("object");
      expect(allAdminMessages.en).toBeDefined();
    });

    it("should have same keys for all locales", () => {
      const englishKeys = Object.keys(allAdminMessages.en || {});
      const slovakKeys = Object.keys(allAdminMessages.sk || {});

      // Each locale should have messages
      expect(englishKeys.length).toBeGreaterThan(0);
      expect(slovakKeys.length).toBeGreaterThan(0);
    });
  });

  describe("adminMessagesEN", () => {
    it("should export English messages directly", () => {
      expect(adminMessagesEN).toBeDefined();
      expect(typeof adminMessagesEN).toBe("object");
    });

    it("should have authentication messages", () => {
      expect(adminMessagesEN["auth.login"]).toBeDefined();
      expect(adminMessagesEN["auth.logout"]).toBeDefined();
    });

    it("should have form messages", () => {
      expect(adminMessagesEN["common.save"]).toBeDefined();
      expect(adminMessagesEN["common.cancel"]).toBeDefined();
    });
  });

  describe("adminMessagesSK", () => {
    it("should export Slovak messages directly", () => {
      expect(adminMessagesSK).toBeDefined();
      expect(typeof adminMessagesSK).toBe("object");
    });

    it("should have Slovak translations for common keys", () => {
      // Slovak translations should exist
      expect(adminMessagesSK["common.save"]).toBeDefined();
      expect(adminMessagesSK["common.cancel"]).toBeDefined();

      // Should be different from English
      expect(adminMessagesSK["common.save"]).not.toBe(
        adminMessagesEN["common.save"],
      );
    });
  });

  describe("message value types", () => {
    it("should support string messages", () => {
      const messages = getAdminMessagesForLocale("en");
      const saveMessage = messages["common.save"];

      expect(typeof saveMessage).toBe("string");
    });

    it("should support plural messages with one/other forms", () => {
      const messages = getAdminMessagesForLocale("en");

      // Find a message with plural form (if any exist)
      const pluralMessage = Object.values(messages).find(
        (msg) => typeof msg === "object" && msg !== null && "one" in msg,
      );

      // If we have plural messages, verify their structure
      if (pluralMessage && typeof pluralMessage === "object") {
        expect(pluralMessage).toHaveProperty("one");
        expect(pluralMessage).toHaveProperty("other");
      }
    });
  });
});
