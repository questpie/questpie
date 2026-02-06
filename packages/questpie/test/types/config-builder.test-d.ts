/**
 * Config Builder Type Tests
 *
 * Tests for questpie(), .collections(), .globals(), .jobs(), .use(), .build()
 * These are compile-time only tests - run with: tsc --noEmit
 */

import { z } from "zod";
import type { QuestpieBuilder } from "#questpie/server/config/builder.js";
import { questpie } from "#questpie/server/config/builder.js";
import type { Questpie } from "#questpie/server/config/cms.js";
import { builtinFields } from "#questpie/server/fields/builtin/defaults.js";
import { job } from "#questpie/server/integrated/queue/job.js";
import type {
  Equal,
  Expect,
  Extends,
  HasKey,
  IsLiteral,
} from "./type-test-utils.js";

// ============================================================================
// Test fixtures — use q.collection() for proper field type inference
// ============================================================================

const q = questpie({ name: "test" }).fields(builtinFields);

const usersCollection = q.collection("users").fields((f) => ({
  name: f.textarea({ required: true }),
  email: f.email({ required: true, maxLength: 255 }),
}));

const postsCollection = q.collection("posts").fields((f) => ({
  title: f.text({ required: true, maxLength: 255 }),
  content: f.textarea(),
  author: f.relation({
    to: "users",
    required: true,
    relationName: "author",
  }),
}));

const settingsGlobal = q.global("settings").fields((f) => ({
  siteName: f.text({ required: true, maxLength: 255 }),
}));

const sendEmailJob = job({
  name: "send-email",
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
  }),
  handler: async ({ payload }) => {
    // Send email
  },
});

// ============================================================================
// questpie() factory tests
// ============================================================================

// questpie() should return QuestpieBuilder
const builder = questpie({ name: "test-app" });
type _builderIsQuestpieBuilder = Expect<
  Extends<typeof builder, QuestpieBuilder<any>>
>;

// Builder should have $inferCms property for type inference
type InferredCms = typeof builder.$inferCms;
type _cmsHasConfig = Expect<HasKey<InferredCms, "config">>;

// ============================================================================
// .collections() method tests
// ============================================================================

// .collections() should accumulate collections
const withCollections = questpie({ name: "app" }).collections({
  users: usersCollection,
  posts: postsCollection,
});

// $inferCms should have collections
type CmsWithCollections = typeof withCollections.$inferCms;
type _cmsHasCollectionsConfig = Expect<
  Equal<HasKey<CmsWithCollections["config"], "collections">, true>
>;

// Collections should be accessible
type Collections = CmsWithCollections["config"]["collections"];
type _hasUsersCollection = Expect<Equal<HasKey<Collections, "users">, true>>;
type _hasPostsCollection = Expect<Equal<HasKey<Collections, "posts">, true>>;

// ============================================================================
// .globals() method tests
// ============================================================================

// .globals() should accumulate globals
const withGlobals = questpie({ name: "app" }).globals({
  settings: settingsGlobal,
});

// $inferCms should have globals
type CmsWithGlobals = typeof withGlobals.$inferCms;
type _cmsHasGlobalsConfig = Expect<
  Equal<HasKey<CmsWithGlobals["config"], "globals">, true>
>;

// Globals should be accessible
type Globals = CmsWithGlobals["config"]["globals"];
type _hasSettingsGlobal = Expect<Equal<HasKey<Globals, "settings">, true>>;

// ============================================================================
// .jobs() method tests
// ============================================================================

// .jobs() should accumulate jobs
const withJobs = questpie({ name: "app" }).jobs({
  sendEmail: sendEmailJob,
});

// Jobs should be typed
type BuilderWithJobs = typeof withJobs;
type _builderWithJobsHasJobs = Expect<
  Extends<BuilderWithJobs, { $inferCms: any }>
>;

// ============================================================================
// .use() method tests (module composition)
// ============================================================================

// Create a module
const blogModule = questpie({ name: "blog" }).collections({
  posts: postsCollection,
});

// .use() should merge module into builder
const withModule = questpie({ name: "app" })
  .collections({ users: usersCollection })
  .use(blogModule);

// Result should have both collections
type CmsWithModule = typeof withModule.$inferCms;
type ModuleCollections = CmsWithModule["config"]["collections"];
type _moduleHasUsers = Expect<Equal<HasKey<ModuleCollections, "users">, true>>;
type _moduleHasPosts = Expect<Equal<HasKey<ModuleCollections, "posts">, true>>;

// ============================================================================
// Chained builder tests
// ============================================================================

// Full builder chain should work
const fullBuilder = questpie({ name: "full-app" })
  .collections({
    users: usersCollection,
    posts: postsCollection,
  })
  .globals({
    settings: settingsGlobal,
  })
  .jobs({
    sendEmail: sendEmailJob,
  });

// All parts should be typed
type FullCms = typeof fullBuilder.$inferCms;
type _fullHasCollections = Expect<
  Equal<HasKey<FullCms["config"], "collections">, true>
>;
type _fullHasGlobals = Expect<
  Equal<HasKey<FullCms["config"], "globals">, true>
>;

// ============================================================================
// Override behavior tests
// ============================================================================

// Later .collections() should override earlier ones
const overrideBuilder = questpie({ name: "app" })
  .collections({ users: usersCollection })
  .collections({ posts: postsCollection });

// Should have both collections (merge, not replace)
type OverrideCms = typeof overrideBuilder.$inferCms;
type OverrideCollections = OverrideCms["config"]["collections"];
// Both should exist after chaining
type _overrideHasUsers = Expect<
  Equal<HasKey<OverrideCollections, "users">, true>
>;
type _overrideHasPosts = Expect<
  Equal<HasKey<OverrideCollections, "posts">, true>
>;

// ============================================================================
// Type accumulation tests
// ============================================================================

// Builder state should accumulate through chain
const step1 = questpie({ name: "app" });
const step2 = step1.collections({ users: usersCollection });
const step3 = step2.globals({ settings: settingsGlobal });

// Each step should have accumulated config
type Step2Cms = typeof step2.$inferCms;
type Step3Cms = typeof step3.$inferCms;

type _step2HasCollections = Expect<
  Equal<HasKey<Step2Cms["config"], "collections">, true>
>;
type _step3HasCollections = Expect<
  Equal<HasKey<Step3Cms["config"], "collections">, true>
>;
type _step3HasGlobals = Expect<
  Equal<HasKey<Step3Cms["config"], "globals">, true>
>;
