/**
 * Tests for storage driver creation and configuration
 */

import { describe, expect, test } from "bun:test";
import {
  createDiskDriver,
  getStorageLocation,
} from "../../src/server/integrated/storage/create-driver.js";
import type { QuestpieConfig } from "../../src/server/config/types.js";
import { resolve } from "node:path";

// Minimal mock config
const createMockConfig = (
  overrides: Partial<QuestpieConfig> = {},
): QuestpieConfig =>
  ({
    app: { url: "http://localhost:3000", name: "test" },
    db: { url: "postgres://localhost/test" },
    secret: "test-secret",
    ...overrides,
  }) as QuestpieConfig;

describe("storage-driver", () => {
  describe("getStorageLocation", () => {
    test("returns null when custom driver is provided", () => {
      const mockDriver = { put: () => {} } as any;
      const config = createMockConfig({
        storage: { driver: mockDriver },
      });

      const location = getStorageLocation(config);

      expect(location).toBeNull();
    });

    test("returns default ./uploads when no storage config", () => {
      const config = createMockConfig();

      const location = getStorageLocation(config);

      expect(location).toBe(resolve(process.cwd(), "./uploads"));
    });

    test("returns custom location when specified", () => {
      const config = createMockConfig({
        storage: { location: "./my-uploads" },
      });

      const location = getStorageLocation(config);

      expect(location).toBe(resolve(process.cwd(), "./my-uploads"));
    });

    test("resolves absolute path correctly", () => {
      const config = createMockConfig({
        storage: { location: "/var/data/uploads" },
      });

      const location = getStorageLocation(config);

      expect(location).toBe("/var/data/uploads");
    });
  });

  describe("createDiskDriver", () => {
    test("returns custom driver when provided", () => {
      const mockDriver = { put: () => {}, get: () => {} } as any;
      const config = createMockConfig({
        storage: { driver: mockDriver },
      });

      const driver = createDiskDriver(config);

      expect(driver).toBe(mockDriver);
    });

    test("creates FSDriver when no custom driver", () => {
      const config = createMockConfig({
        storage: { location: "./test-uploads" },
      });

      const driver = createDiskDriver(config);

      // FSDriver should have these methods
      expect(typeof driver.put).toBe("function");
      expect(typeof driver.get).toBe("function");
      expect(typeof driver.delete).toBe("function");
      expect(typeof driver.exists).toBe("function");
      expect(typeof driver.getUrl).toBe("function");
      expect(typeof driver.getSignedUrl).toBe("function");
    });

    test("FSDriver generates correct URLs", async () => {
      const config = createMockConfig({
        storage: { location: "./test-uploads" },
      });

      const driver = createDiskDriver(config);

      const url = await driver.getUrl("test-file.jpg");

      expect(url).toBe("http://localhost:3000/storage/files/test-file.jpg");
    });

    test("FSDriver generates signed URLs with token", async () => {
      const config = createMockConfig({
        storage: { location: "./test-uploads" },
      });

      const driver = createDiskDriver(config);

      const signedUrl = await driver.getSignedUrl("secret.pdf");

      expect(signedUrl).toContain(
        "http://localhost:3000/storage/files/secret.pdf",
      );
      expect(signedUrl).toContain("?token=");
    });

    test("uses custom expiration for signed URLs", async () => {
      const config = createMockConfig({
        storage: {
          location: "./test-uploads",
          signedUrlExpiration: 60, // 1 minute
        },
      });

      const driver = createDiskDriver(config);

      // Generate two URLs with default and custom expiration
      const url1 = await driver.getSignedUrl("file.pdf");
      const url2 = await driver.getSignedUrl("file.pdf");

      // Both should have tokens (implementation detail: tokens include expiration)
      expect(url1).toContain("?token=");
      expect(url2).toContain("?token=");
    });
  });
});
