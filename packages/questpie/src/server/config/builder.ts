import type { BetterAuthOptions } from "better-auth";
import type { MailAdapter, QueueAdapter } from "#questpie/exports/index.js";
import { CollectionBuilder } from "#questpie/server/collection/builder/collection-builder.js";
import type { EmptyCollectionState } from "#questpie/server/collection/builder/types.js";
import type {
  BuilderCollectionsMap,
  BuilderEmailTemplatesMap,
  BuilderFieldsMap,
  BuilderGlobalsMap,
  BuilderJobsMap,
  QuestpieBuilderState,
  QuestpieRuntimeConfig,
} from "#questpie/server/config/builder-types.js";
import { Questpie } from "#questpie/server/config/cms.js";
import type { QuestpieBuilderExtensions } from "#questpie/server/config/extensions.js";
import type {
  DbConfig,
  LocaleConfig,
  QuestpieConfig,
} from "#questpie/server/config/types.js";
import type {
  FunctionDefinition,
  JsonFunctionDefinition,
  RawFunctionDefinition,
} from "#questpie/server/functions/types.js";
import { GlobalBuilder } from "#questpie/server/global/builder/global-builder.js";
import type { EmptyGlobalState } from "#questpie/server/global/builder/types.js";
import {
  mergeMessagesIntoConfig,
  mergeTranslationsConfig,
} from "#questpie/server/i18n/translator.js";
import type {
  InferMessageKeys,
  MessagesShape,
  TranslationsConfig,
} from "#questpie/server/i18n/types.js";
import {
  type MergeAuthOptions,
  mergeAuthOptions,
} from "#questpie/server/integrated/auth/merge.js";
import type { EmailTemplateDefinition } from "#questpie/server/integrated/mailer/template.js";
import type { JobDefinition } from "#questpie/server/integrated/queue/types.js";
import type { Migration } from "#questpie/server/migration/types.js";
import type {
  PrettifiedAnyCollectionOrBuilder,
  PrettifiedAnyGlobalOrBuilder,
  Prettify,
  SetProperty,
  TypeMerge,
  UnsetProperty,
} from "#questpie/shared/type-utils.js";

type QuestpieFromState<TState extends QuestpieBuilderState> = Questpie<
  Prettify<
    TypeMerge<
      QuestpieConfig,
      {
        collections: TState["collections"];
        globals: TState["globals"];
        auth: TState["auth"];
        queue: { jobs: TState["jobs"]; adapter: QueueAdapter };
        email: { templates: TState["emailTemplates"]; adapter: MailAdapter };
        db: { url: string }; // lets enforce a bunsql type on inferred cms types from builder
      }
    >
  >
>;

/**
 * Questpie Builder - Fluent API for building CMS instances
 *
 * Supports:
 * - Incremental configuration via builder pattern
 * - Module composition via .use()
 * - Type-safe collections, globals, jobs as maps
 * - Override mechanism (last wins)
 * - Separation of definition-time and runtime config
 *
 * @example
 * ```ts
 * const cms = questpie({ name: 'my-app' })
 *   .locale({ locales: ['en', 'sk'], defaultLocale: 'en' })
 *   .auth(betterAuthOptions)
 *   .collections({
 *     posts: postsCollection,
 *     comments: commentsCollection,
 *   })
 *   .jobs({
 *     sendEmail: sendEmailJob,
 *   })
 *   .emailTemplates({
 *     welcome: welcomeTemplate,
 *   })
 *   .build({
 *     app: { url: process.env.APP_URL },
 *     db: { url: process.env.DATABASE_URL },
 *     storage: { driver: s3Driver(...) },
 *     email: { adapter: smtpAdapter(...) },
 *     queue: { adapter: pgBossAdapter(...) },
 *   })
 * ```
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: Declaration merging is intentional for extension pattern
export class QuestpieBuilder<
  TState extends QuestpieBuilderState = QuestpieBuilderState,
> {
  public readonly state: TState;
  /**
   * Note: Public for module composition purposes
   * No value at runtime - purely for type inference.
   */
  declare public readonly $inferCms: QuestpieFromState<TState>;
  /**
   * Type-only property for accessing state type in conditional types.
   * Used by CollectionBuilder to extract field types.
   */
  declare public readonly $state: TState;

  static empty<TName extends string>(name: TName) {
    return new QuestpieBuilder({
      name,
      collections: {},
      globals: {},
      jobs: {},
      emailTemplates: {},
      fields: {},
      auth: {},
      locale: undefined,
      migrations: undefined,
      translations: undefined,
      "~messageKeys": undefined,
    });
  }

  constructor(state: TState) {
    this.state = state;
  }

  /**
   * Define collections (as a map for type-safe access)
   *
   * @example
   * ```ts
   * .collections({
   *   posts: postsCollection,
   *   comments: commentsCollection,
   * })
   * ```
   */
  collections<TNewCollections extends BuilderCollectionsMap>(
    collections: TNewCollections,
  ): QuestpieBuilder<
    SetProperty<
      TState,
      "collections",
      Prettify<
        TypeMerge<
          UnsetProperty<TState["collections"], keyof TNewCollections>,
          {
            [K in keyof TNewCollections]: PrettifiedAnyCollectionOrBuilder<
              TNewCollections[K]
            >;
          }
        >
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      collections: {
        ...this.state.collections,
        ...collections,
      },
    } as any);
  }

  /**
   * Define globals (as a map for type-safe access)
   *
   * @example
   * ```ts
   * .globals({
   *   siteSettings: siteSettingsGlobal,
   * })
   * ```
   */
  globals<TNewGlobals extends BuilderGlobalsMap>(
    globals: TNewGlobals,
  ): QuestpieBuilder<
    SetProperty<
      TState,
      "globals",
      Prettify<
        TypeMerge<
          UnsetProperty<TState["globals"], keyof TNewGlobals>,
          {
            [K in keyof TNewGlobals]: PrettifiedAnyGlobalOrBuilder<
              TNewGlobals[K]
            >;
          }
        >
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      globals: {
        ...this.state.globals,
        ...globals,
      },
    } as any);
  }

  /**
   * Define jobs (as a map for type-safe access)
   *
   * @example
   * ```ts
   * .jobs({
   *   sendEmail: sendEmailJob,
   *   processImage: processImageJob,
   * })
   * ```
   */
  jobs<TNewJobs extends BuilderJobsMap>(
    jobs: TNewJobs,
  ): QuestpieBuilder<
    SetProperty<
      TState,
      "jobs",
      Prettify<
        TypeMerge<UnsetProperty<TState["jobs"], keyof TNewJobs>, TNewJobs>
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      jobs: {
        ...this.state.jobs,
        ...jobs,
      },
    } as any);
  }

  /**
   * Define email templates (as a map for type-safe access)
   *
   * @example
   * ```ts
   * .emailTemplates({
   *   welcome: welcomeTemplate,
   *   resetPassword: resetPasswordTemplate,
   * })
   * ```
   */
  emailTemplates<TNewEmailTemplates extends BuilderEmailTemplatesMap>(
    emailTemplates: TNewEmailTemplates,
  ): QuestpieBuilder<
    SetProperty<
      TState,
      "emailTemplates",
      Prettify<
        TypeMerge<
          UnsetProperty<TState["emailTemplates"], keyof TNewEmailTemplates>,
          TNewEmailTemplates
        >
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      emailTemplates: {
        ...this.state.emailTemplates,
        ...emailTemplates,
      },
    } as any);
  }

  /**
   * Register field types for the Field Builder system.
   * Fields are available when defining collections with `.fields((f) => ({ ... }))`.
   *
   * @example
   * ```ts
   * import { textField, numberField } from "@questpie/server/fields";
   *
   * const q = questpie({ name: "app" })
   *   .fields({
   *     text: textField,
   *     number: numberField,
   *   });
   *
   * // Now available in collections:
   * const posts = collection("posts")
   *   .fields((f) => ({
   *     title: f.text({ required: true }),
   *     views: f.number({ min: 0 }),
   *   }));
   * ```
   */
  fields<TNewFields extends BuilderFieldsMap>(
    fields: TNewFields,
  ): QuestpieBuilder<
    SetProperty<
      TState,
      "fields",
      Prettify<
        TypeMerge<UnsetProperty<TState["fields"], keyof TNewFields>, TNewFields>
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      fields: {
        ...this.state.fields,
        ...fields,
      },
    } as any);
  }

  /**
   * Configure authentication (Better Auth)
   * Type-inferrable - affects auth instance type
   * Override strategy: Last wins
   *
   * @example
   * ```ts
   * // With BetterAuthOptions (merged with core auth defaults)
   * .auth({
   *   emailAndPassword: { enabled: true, requireEmailVerification: false },
   *   baseURL: "http://localhost:3000",
   *   secret: process.env.BETTER_AUTH_SECRET,
   * })
   * ```
   *
   * @example
   * ```ts
   * // With factory function (full control over DB wiring)
   * .auth((db) =>
   *   withAuthDatabase(mergeAuthOptions(coreAuthOptions, {
   *     emailAndPassword: { enabled: true, requireEmailVerification: false },
   *     baseURL: "http://localhost:3000",
   *     secret: process.env.BETTER_AUTH_SECRET,
   *   }), db)
   * )
   * ```
   *
   * @example
   * ```ts
   * // With Better Auth instance
   * .auth(betterAuth({
   *   database: drizzleAdapter(db, { provider: "pg" }),
   *   emailAndPassword: { enabled: true },
   *   baseURL: 'http://localhost:3000',
   * }))
   * ```
   */
  auth<const TNewAuth extends BetterAuthOptions>(
    auth: TNewAuth | ((oldAuth: TState["auth"]) => TNewAuth),
  ): QuestpieBuilder<
    SetProperty<TState, "auth", MergeAuthOptions<TState["auth"], TNewAuth>>
  > {
    return new QuestpieBuilder({
      ...this.state,
      auth: mergeAuthOptions(
        this.state.auth,
        typeof auth === "function" ? auth(this.state.auth) : auth,
      ),
    } as any);
  }

  /**
   * Configure localization
   * Type-inferrable - affects i18n table generation
   * Override strategy: Last wins
   *
   * @example
   * ```ts
   * .locale({
   *   locales: [{ code: 'en' }, { code: 'sk' }],
   *   defaultLocale: 'en',
   * })
   * ```
   */
  locale(
    locale: LocaleConfig,
  ): QuestpieBuilder<SetProperty<TState, "locale", LocaleConfig>> {
    return new QuestpieBuilder({
      ...this.state,
      locale,
    } as any);
  }

  /**
   * Add migrations
   * Merges with existing migrations
   *
   * @example
   * ```ts
   * .migrations([customMigration1, customMigration2])
   * ```
   */
  migrations(
    migrations: Migration[],
  ): QuestpieBuilder<SetProperty<TState, "migrations", Migration[]>> {
    return new QuestpieBuilder({
      ...this.state,
      migrations: [...(this.state.migrations || []), ...migrations],
    } as any);
  }

  /**
   * Add translated messages for backend (simple API)
   *
   * Messages are merged with existing messages from modules.
   * Custom messages override defaults with same key.
   * Message keys are tracked in the type system for type-safe access via cms.t().
   *
   * @example
   * ```ts
   * const messages = {
   *   en: {
   *     "booking.created": "Booking created for {{date}}",
   *     "booking.cancelled": "Booking was cancelled",
   *   },
   *   sk: {
   *     "booking.created": "Rezervácia vytvorená na {{date}}",
   *     "booking.cancelled": "Rezervácia bola zrušená",
   *   },
   * } as const;
   *
   * const cms = q({ name: "app" })
   *   .messages(messages)
   *   .build({ ... });
   *
   * // cms.t("booking.created") is type-safe!
   * ```
   */
  messages<TMessages extends MessagesShape>(
    messages: TMessages,
    options?: { fallbackLocale?: string },
  ): QuestpieBuilder<
    Prettify<
      TypeMerge<
        UnsetProperty<TState, "translations" | "~messageKeys">,
        {
          translations: TranslationsConfig;
          "~messageKeys":
            | Extract<TState["~messageKeys"], string>
            | InferMessageKeys<TMessages>;
        }
      >
    >
  > {
    return new QuestpieBuilder({
      ...this.state,
      translations: mergeMessagesIntoConfig(
        this.state.translations,
        messages,
        options?.fallbackLocale,
      ),
    } as any);
  }

  /**
   * Use (compose) another Questpie builder (module composition)
   * Override strategy: Last wins for all properties
   *
   * @example
   * ```ts
   * // Simple module composition
   * const blogModule = questpie({ name: 'blog' })
   *   .collections({
   *     posts: postsCollection,
   *     categories: categoriesCollection,
   *   })
   *   .jobs({
   *     publishPost: publishPostJob,
   *   })
   *
   * const cms = questpie({ name: 'app' })
   *   .use(blogModule)
   *   .collections({
   *     products: productsCollection,
   *   })
   *   .build({ ... })
   * ```
   *
   * @example
   * ```ts
   * // Override/extend collection from module using .merge()
   * const blogModule = questpie({ name: 'blog' })
   *   .collections({ posts: postsCollection })
   *
   * const cms = questpie({ name: 'app' })
   *   .use(blogModule)
   *   .collections({
   *     // Override posts collection with custom fields
   *     posts: blogModule.state.collections.posts.merge(
   *       collection("posts").fields({
   *         featured: boolean("featured").default(false),
   *         viewCount: integer("view_count").default(0),
   *       })
   *     )
   *   })
   * ```
   */
  use<
    TOtherState extends {
      name: string;
      collections: BuilderCollectionsMap;
      globals: BuilderGlobalsMap;
      jobs: BuilderJobsMap;
      emailTemplates: BuilderEmailTemplatesMap;
      fields: BuilderFieldsMap;
      auth: BetterAuthOptions | Record<never, never>;
      locale?: any;
      migrations?: any;
      translations?: any;
      "~messageKeys"?: any;
    },
  >(other: {
    readonly state: TOtherState;
  }): QuestpieBuilder<
    Prettify<
      TypeMerge<
        TState,
        {
          collections: TypeMerge<
            UnsetProperty<
              TState["collections"],
              keyof TOtherState["collections"]
            >,
            TOtherState["collections"]
          >;
          globals: TypeMerge<
            UnsetProperty<TState["globals"], keyof TOtherState["globals"]>,
            TOtherState["globals"]
          >;
          jobs: TypeMerge<
            UnsetProperty<TState["jobs"], keyof TOtherState["jobs"]>,
            TOtherState["jobs"]
          >;
          emailTemplates: TypeMerge<
            UnsetProperty<
              TState["emailTemplates"],
              keyof TOtherState["emailTemplates"]
            >,
            TOtherState["emailTemplates"]
          >;
          fields: TypeMerge<
            UnsetProperty<TState["fields"], keyof TOtherState["fields"]>,
            TOtherState["fields"]
          >;
          auth: MergeAuthOptions<TState["auth"], TOtherState["auth"]>;
          "~messageKeys":
            | Extract<TState["~messageKeys"], string>
            | Extract<TOtherState["~messageKeys"], string>;
        }
      >
    >
  > {
    const otherState = other.state;

    return new QuestpieBuilder({
      name: this.state.name, // Keep current name
      collections: {
        ...this.state.collections,
        ...otherState.collections,
      },
      globals: {
        ...this.state.globals,
        ...otherState.globals,
      },
      jobs: {
        ...this.state.jobs,
        ...otherState.jobs,
      },
      emailTemplates: {
        ...this.state.emailTemplates,
        ...otherState.emailTemplates,
      },
      fields: {
        ...this.state.fields,
        ...otherState.fields,
      },
      auth: mergeAuthOptions(this.state.auth, otherState.auth),

      locale: otherState.locale ?? this.state.locale,
      migrations: [
        ...(this.state.migrations || []),
        ...(otherState.migrations || []),
      ],
      translations: mergeTranslationsConfig(
        this.state.translations,
        otherState.translations,
      ),
    } as any);
  }

  // ============================================================================
  // Entity Creation Methods
  // ============================================================================

  /**
   * Create a collection builder bound to this Questpie builder.
   * The collection has access to all registered field types from `.fields()`.
   *
   * @example
   * ```ts
   * import { defaultFields } from "@questpie/server/fields/builtin";
   *
   * const q = questpie({ name: "app" })
   *   .fields(defaultFields);
   *
   * // Use q.collection() for type-safe field access:
   * const posts = q.collection("posts")
   *   .fields((f) => ({
   *     title: f.text({ required: true }),  // ✅ autocomplete from defaultFields
   *     views: f.number({ min: 0 }),
   *   }));
   *
   * const cms = q
   *   .collections({ posts })
   *   .build({ ... });
   * ```
   */
  collection<TName extends string>(
    name: TName,
  ): CollectionBuilder<
    EmptyCollectionState<TName, QuestpieBuilder<TState>, TState["fields"]>
  > {
    return new CollectionBuilder({
      name,
      fields: {},
      localized: [],
      virtuals: undefined,
      relations: {},
      indexes: {},
      title: undefined,
      options: {},
      hooks: {},
      access: {},
      functions: {},
      searchable: undefined,
      validation: undefined,
      output: undefined,
      upload: undefined,
      fieldDefinitions: {},
      "~questpieApp": this,
      "~fieldTypes": undefined, // Type only - passed via generics
    }) as any;
  }

  /**
   * Create a global builder bound to this Questpie builder.
   * The global has access to all registered field types from `.fields()`.
   *
   * @example
   * ```ts
   * import { defaultFields } from "@questpie/server/fields/builtin";
   *
   * const q = questpie({ name: "app" })
   *   .fields(defaultFields);
   *
   * // Use q.global() for type-safe field access:
   * const settings = q.global("settings")
   *   .fields((f) => ({
   *     siteName: f.text({ required: true }),  // ✅ autocomplete from defaultFields
   *     maintenanceMode: f.boolean({ default: false }),
   *   }));
   *
   * const cms = q
   *   .globals({ settings })
   *   .build({ ... });
   * ```
   */
  global<TName extends string>(
    name: TName,
  ): GlobalBuilder<
    EmptyGlobalState<TName, QuestpieBuilder<TState>, TState["fields"]>
  > {
    return new GlobalBuilder({
      name,
      fields: {},
      localized: [],
      virtuals: {},
      relations: {},
      options: {},
      hooks: {},
      access: {},
      functions: {},
      fieldDefinitions: undefined,
      "~questpieApp": this,
      "~fieldTypes": undefined, // Type only - passed via generics
    }) as any;
  }

  // ============================================================================
  // Factory Methods (passthrough helpers for type-safe definitions)
  // ============================================================================

  /**
   * Define a background job with type-safe payload and handler.
   *
   * @example
   * ```ts
   * const sendEmailJob = q.job({
   *   name: 'send-email',
   *   schema: z.object({
   *     to: z.string().email(),
   *     subject: z.string(),
   *   }),
   *   handler: async ({ payload, app }) => {
   *     await app.email.send({ to: payload.to, subject: payload.subject, html: '...' });
   *   },
   * });
   *
   * const cms = q.jobs({ sendEmail: sendEmailJob }).build({ ... });
   * ```
   */
  job<TName extends string, TPayload, TResult = void>(
    definition: JobDefinition<TPayload, TResult, TName>,
  ): JobDefinition<TPayload, TResult, TName> {
    return definition;
  }

  /**
   * Define an RPC function with type-safe input/output.
   *
   * @example
   * ```ts
   * const getStats = q.fn({
   *   schema: z.object({ period: z.enum(['day', 'week', 'month']) }),
   *   handler: async ({ input, app }) => {
   *     return { visits: 100, orders: 50 };
   *   },
   * });
   *
   * const appRpc = rpc().router({ getStats });
   * ```
   */
  fn<TInput, TOutput>(
    definition: JsonFunctionDefinition<TInput, TOutput>,
  ): JsonFunctionDefinition<TInput, TOutput>;
  fn(definition: RawFunctionDefinition): RawFunctionDefinition;
  fn(definition: FunctionDefinition): FunctionDefinition {
    return definition;
  }

  /**
   * Define an email template with type-safe context.
   *
   * @example
   * ```ts
   * const welcomeEmail = q.email({
   *   name: 'welcome',
   *   schema: z.object({ name: z.string(), activationLink: z.string().url() }),
   *   render: ({ name, activationLink }) => (
   *     <div>
   *       <h1>Welcome, {name}!</h1>
   *       <a href={activationLink}>Activate</a>
   *     </div>
   *   ),
   *   subject: (ctx) => `Welcome, ${ctx.name}!`,
   * });
   *
   * const cms = q.emailTemplates({ welcome: welcomeEmail }).build({ ... });
   * ```
   */
  email<TName extends string, TContext>(
    definition: EmailTemplateDefinition<TContext, TName>,
  ): EmailTemplateDefinition<TContext, TName> {
    return definition;
  }

  /**
   * Build the final Questpie instance
   * Requires runtime configuration (app.url, db.url, etc.)
   *
   * @example
   * ```ts
   * .build({
   *   app: { url: process.env.APP_URL },
   *   db: { url: process.env.DATABASE_URL },
   *   secret: process.env.SECRET,
   *   storage: { driver: s3Driver(...) },
   *   email: { adapter: smtpAdapter(...) },
   *   queue: { adapter: pgBossAdapter(...) },
   * })
   * ```
   */
  build<TDbConfig extends DbConfig = DbConfig>(
    runtimeConfig: QuestpieRuntimeConfig<TDbConfig>,
  ): QuestpieFromState<Prettify<TState>> {
    // Build QuestpieConfig with object-based collections, globals, jobs, templates
    const cmsConfig: QuestpieConfig = {
      app: runtimeConfig.app,
      db: runtimeConfig.db,
      secret: runtimeConfig.secret,
      collections: this.state.collections,
      globals: this.state.globals,
      locale: this.state.locale,
      auth: this.state.auth,
      storage: runtimeConfig.storage,
      email: runtimeConfig.email
        ? {
            ...runtimeConfig.email,
            templates: this.state.emailTemplates,
          }
        : undefined,
      queue:
        Object.keys(this.state.jobs).length > 0 && runtimeConfig.queue
          ? {
              jobs: this.state.jobs,
              adapter: runtimeConfig.queue.adapter,
            }
          : undefined,
      search: runtimeConfig.search,
      realtime: runtimeConfig.realtime,
      logger: runtimeConfig.logger,
      kv: runtimeConfig.kv,
      migrations: {
        migrations: this.state.migrations,
      },
      translations: this.state.translations,
      defaultAccess: runtimeConfig.defaultAccess,
    };

    return new Questpie(cmsConfig) as any;
  }
}

// =============================================================================
// Declaration Merging for Extensions
// =============================================================================

/**
 * Declaration merging: QuestpieBuilder implements QuestpieBuilderExtensions.
 *
 * This allows packages to augment QuestpieBuilderExtensions and have those
 * methods appear on QuestpieBuilder instances.
 */
export interface QuestpieBuilder<
  TState extends QuestpieBuilderState,
> extends QuestpieBuilderExtensions {}

/**
 * Helper function to start building a Questpie instance
 *
 * Returns an empty builder - use .use(starterModule) to include
 * auth collections and file upload support.
 *
 * @example
 * ```ts
 * // Minimal setup (no auth, no file uploads)
 * const cms = questpie({ name: 'my-app' })
 *   .collections({ posts: postsCollection })
 *   .build({ db: { url: '...' } })
 * ```
 *
 * @example
 * ```ts
 * // With starter module (auth + file uploads)
 * import { questpie, starterModule } from "@questpie/server";
 *
 * const cms = questpie({ name: 'my-app' })
 *   .use(starterModule)
 *   .collections({ posts: postsCollection })
 *   .build({
 *     db: { url: '...' },
 *     storage: { driver: s3Driver(...) },
 *   })
 * ```
 *
 * @example
 * ```ts
 * // Custom upload collection without starter module
 * const cms = questpie({ name: 'my-app' })
 *   .collections({
 *     media: collection("media")
 *       .fields({ alt: varchar("alt", { length: 500 }) })
 *       .upload({ visibility: "public", maxSize: 10_000_000 }),
 *   })
 *   .build({ db: { url: '...' }, storage: { driver: fsDriver(...) } })
 * ```
 */
export function questpie<TName extends string>(config: { name: TName }) {
  return QuestpieBuilder.empty(config.name);
}

/**
 * Type for a callable QuestpieBuilder.
 * Can be invoked as a function to create new builders, while also having all builder methods.
 */
export type CallableQuestpieBuilder<TState extends QuestpieBuilderState> =
  QuestpieBuilder<TState> &
    (<TName extends string>(config: {
      name: TName;
    }) => QuestpieBuilder<
      QuestpieBuilderState<TName, {}, {}, {}, {}, {}, never, TState["fields"]>
    >);

/**
 * Create a callable QuestpieBuilder that can be both invoked as a function
 * and used directly as a builder instance.
 *
 * When called as a function, it creates a new builder with the same field types.
 * When used as an object, it provides all builder methods directly.
 *
 * @example
 * ```ts
 * const q = createCallableBuilder(
 *   questpie({ name: "base" }).fields(defaultFields)
 * );
 *
 * // Use as builder directly
 * const posts = q.collection("posts").fields((f) => ({
 *   title: f.text({ required: true }),
 * }));
 *
 * // Or create new builder with same fields
 * const myApp = q({ name: "my-app" })
 *   .collections({ posts })
 *   .build({ ... });
 * ```
 */
export function createCallableBuilder<TState extends QuestpieBuilderState>(
  builder: QuestpieBuilder<TState>,
): CallableQuestpieBuilder<TState> {
  // Create the callable function
  const callable = <TName extends string>(config: { name: TName }) => {
    // Create new builder with same fields but fresh state
    return QuestpieBuilder.empty(config.name).fields(
      builder.state.fields,
    ) as any;
  };

  // Copy all properties and methods from the builder to the callable
  Object.setPrototypeOf(callable, QuestpieBuilder.prototype);
  Object.assign(callable, builder);

  // Copy the state property explicitly
  Object.defineProperty(callable, "state", {
    value: builder.state,
    writable: false,
    enumerable: true,
  });

  return callable as CallableQuestpieBuilder<TState>;
}
