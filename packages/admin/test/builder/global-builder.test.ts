/**
 * Global Builder Tests
 *
 * Tests for GlobalBuilder class and global() factory.
 */

import { describe, it, expect } from "bun:test";
import { global } from "#questpie/admin/client/builder/global/global";
import { GlobalBuilder } from "#questpie/admin/client/builder/global/global-builder";
import { AdminBuilder } from "#questpie/admin/client/builder/admin-builder";
import {
  createTextField,
  createEmailField,
  createFormView,
  MockIcon,
} from "../utils/helpers";

describe("global() factory", () => {
  it("should create a GlobalBuilder with the given name", () => {
    const settings = global("settings");

    expect(settings).toBeInstanceOf(GlobalBuilder);
    expect(settings.state.name).toBe("settings");
  });

  it("should initialize with undefined ~adminApp", () => {
    const settings = global("settings");

    expect(settings.state["~adminApp"]).toBeUndefined();
  });

  it("should allow any string as global name", () => {
    const siteSettings = global("siteSettings");
    const siteConfig = global("site-config");
    const theme_settings = global("theme_settings");

    expect(siteSettings.state.name).toBe("siteSettings");
    expect(siteConfig.state.name).toBe("site-config");
    expect(theme_settings.state.name).toBe("theme_settings");
  });
});

describe("GlobalBuilder.use()", () => {
  it("should bind admin module to global", () => {
    const adminModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    const settings = global("settings").use(adminModule);

    expect(settings.state["~adminApp"]).toBe(adminModule);
  });

  it("should return new builder instance", () => {
    const adminModule = AdminBuilder.empty();
    const original = global("settings");
    const withModule = original.use(adminModule);

    expect(original).not.toBe(withModule);
  });

  it("should not mutate original builder", () => {
    const adminModule = AdminBuilder.empty();
    const original = global("settings");

    original.use(adminModule);

    expect(original.state["~adminApp"]).toBeUndefined();
  });

  it("should allow replacing admin module", () => {
    const module1 = AdminBuilder.empty().fields({ text: createTextField() });
    const module2 = AdminBuilder.empty().fields({ email: createEmailField() });

    const settings = global("settings").use(module1).use(module2);

    expect(settings.state["~adminApp"]).toBe(module2);
  });
});

describe("GlobalBuilder.meta()", () => {
  it("should set label", () => {
    const settings = global("settings").meta({ label: "Site Settings" });

    expect(settings.state.label).toBe("Site Settings");
  });

  it("should set icon", () => {
    const settings = global("settings").meta({ icon: MockIcon });

    expect(settings.state.icon).toBe(MockIcon);
  });

  it("should set description", () => {
    const settings = global("settings").meta({
      description: "Configure site-wide settings",
    });

    expect(settings.state.description).toBe("Configure site-wide settings");
  });

  it("should set multiple metadata at once", () => {
    const settings = global("settings").meta({
      label: "Site Settings",
      icon: MockIcon,
      description: "Configure site-wide settings",
    });

    expect(settings.state.label).toBe("Site Settings");
    expect(settings.state.icon).toBe(MockIcon);
    expect(settings.state.description).toBe("Configure site-wide settings");
  });

  it("should return new builder instance", () => {
    const original = global("settings");
    const withMeta = original.meta({ label: "Settings" });

    expect(original).not.toBe(withMeta);
  });

  it("should not mutate original builder", () => {
    const original = global("settings");

    original.meta({ label: "Settings" });

    expect(original.state.label).toBeUndefined();
  });

  it("should preserve existing state", () => {
    const settings = global("settings")
      .meta({ label: "Settings" })
      .meta({ description: "Site settings" });

    expect(settings.state.label).toBe("Settings");
    expect(settings.state.description).toBe("Site settings");
  });
});

describe("GlobalBuilder.state", () => {
  it("should expose readonly state", () => {
    const settings = global("settings").meta({ label: "Site Settings" });

    expect(settings.state).toBeDefined();
    expect(settings.state.name).toBe("settings");
    expect(settings.state.label).toBe("Site Settings");
  });
});

describe("GlobalBuilder - Full Configuration Chain", () => {
  it("should allow complete configuration chain", () => {
    const adminModule = AdminBuilder.empty()
      .fields({
        text: createTextField(),
        email: createEmailField(),
      })
      .views({
        form: createFormView(),
      });

    const settings = global("settings").use(adminModule).meta({
      label: "Site Settings",
      icon: MockIcon,
      description: "Configure your site",
    });

    // Verify all state is correctly set
    expect(settings.state.name).toBe("settings");
    expect(settings.state.label).toBe("Site Settings");
    expect(settings.state.icon).toBe(MockIcon);
    expect(settings.state.description).toBe("Configure your site");
    expect(settings.state["~adminApp"]).toBe(adminModule);
  });
});

describe("GlobalBuilder immutability", () => {
  it("should create new instance on every method call", () => {
    const adminModule = AdminBuilder.empty()
      .fields({ text: createTextField() })
      .views({ form: createFormView() });

    const a = global("settings");
    const b = a.use(adminModule);
    const c = b.meta({ label: "Settings" });

    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });
});

describe("GlobalBuilder vs CollectionBuilder", () => {
  it("should have similar API to CollectionBuilder", async () => {
    // GlobalBuilder and CollectionBuilder should have matching APIs for:
    // - use()
    // - meta()

    const adminModule = AdminBuilder.empty().fields({
      text: createTextField(),
    });

    // Both support use/meta
    const { collection } =
      await import("#questpie/admin/client/builder/collection/collection");
    const collectionBuilder = collection("posts")
      .use(adminModule)
      .meta({ label: "Posts" });

    const globalBuilder = global("settings")
      .use(adminModule)
      .meta({ label: "Settings" });

    // Both have use and meta
    expect(typeof collectionBuilder.use).toBe("function");
    expect(typeof collectionBuilder.meta).toBe("function");
    expect(typeof globalBuilder.use).toBe("function");
    expect(typeof globalBuilder.meta).toBe("function");

    // Collection has preview and autoSave, global doesn't
    expect(typeof (collectionBuilder as any).preview).toBe("function");
    expect(typeof (collectionBuilder as any).autoSave).toBe("function");
    expect((globalBuilder as any).preview).toBeUndefined();
    expect((globalBuilder as any).autoSave).toBeUndefined();
  });
});
