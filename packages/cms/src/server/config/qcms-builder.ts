import type {
	BuilderCollectionsMap,
	BuilderEmailTemplatesMap,
	BuilderFunctionsMap,
	BuilderGlobalsMap,
	BuilderJobsMap,
	QCMSBuilderState,
	QCMSRuntimeConfig,
} from "#questpie/cms/server/config/builder-types";
import { QCMS } from "#questpie/cms/server/config/cms";
import type {
	AuthConfig,
	CMSConfig,
	CMSDbConfig,
	LocaleConfig,
} from "#questpie/cms/server/config/types";
import type { Migration } from "#questpie/cms/server/migration/types";
import { createCoreModule } from "#questpie/cms/server/modules/core/core.module.js";

type QCMSFromState<TState extends QCMSBuilderState> = QCMS<
	CMSConfig & {
		collections: TState["collections"];
		globals: TState["globals"];
		functions: TState["functions"];
		auth: TState["auth"];
		queue: TState["jobs"] extends Record<string, never>
			? undefined
			: { jobs: TState["jobs"]; adapter: any };
		email: TState["emailTemplates"] extends Record<string, never>
			? undefined
			: { templates: TState["emailTemplates"]; adapter: any };
	}
>;

/**
 * QCMS Builder - Fluent API for building CMS instances
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
 * const cms = defineQCMS({ name: 'my-app' })
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
export class QCMSBuilder<TState extends QCMSBuilderState = QCMSBuilderState> {
	private state: TState;
	public declare readonly $inferCms: QCMSFromState<TState>;

	static empty<TName extends string>(name: TName) {
		return new QCMSBuilder({
			name,
			collections: {},
			globals: {},
			jobs: {},
			emailTemplates: {},
			functions: {},
			auth: undefined,
			locale: undefined,
			migrations: undefined,
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
	): QCMSBuilder<
		Omit<TState, "collections"> & {
			collections: Omit<TState["collections"], keyof TNewCollections> &
				TNewCollections;
		}
	> {
		return new QCMSBuilder({
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
	): QCMSBuilder<
		Omit<TState, "globals"> & {
			globals: Omit<TState["globals"], keyof TNewGlobals> & TNewGlobals;
		}
	> {
		return new QCMSBuilder({
			...this.state,
			globals: {
				...this.state.globals,
				...globals,
			},
		} as any);
	}

	/**
	 * Define root RPC functions (as a map for type-safe access)
	 *
	 * @example
	 * ```ts
	 * .functions({
	 *   ping: pingFunction,
	 * })
	 * ```
	 */
	functions<TNewFunctions extends BuilderFunctionsMap>(
		functions: TNewFunctions,
	): QCMSBuilder<
		Omit<TState, "functions"> & {
			functions: Omit<TState["functions"], keyof TNewFunctions> & TNewFunctions;
		}
	> {
		return new QCMSBuilder({
			...this.state,
			functions: {
				...this.state.functions,
				...functions,
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
	): QCMSBuilder<
		Omit<TState, "jobs"> & {
			jobs: Omit<TState["jobs"], keyof TNewJobs> & TNewJobs;
		}
	> {
		return new QCMSBuilder({
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
	): QCMSBuilder<
		Omit<TState, "emailTemplates"> & {
			emailTemplates: Omit<TState["emailTemplates"], keyof TNewEmailTemplates> &
				TNewEmailTemplates;
		}
	> {
		return new QCMSBuilder({
			...this.state,
			emailTemplates: {
				...this.state.emailTemplates,
				...emailTemplates,
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
	 * // With BetterAuthOptions
	 * .auth(defaultQCMSAuth(db, {
	 *   emailPassword: true,
	 *   baseURL: 'http://localhost:3000',
	 * }))
	 * ```
	 *
	 * @example
	 * ```ts
	 * // With factory function (recommended - shares db connection)
	 * .auth((db) => defaultQCMSAuth(db, {
	 *   emailPassword: true,
	 *   baseURL: 'http://localhost:3000',
	 * }))
	 * ```
	 *
	 * @example
	 * ```ts
	 * // With Better Auth instance
	 * .auth(betterAuth({
	 *   database: { client: db, type: 'postgres' },
	 *   emailAndPassword: { enabled: true },
	 *   baseURL: 'http://localhost:3000',
	 * }))
	 * ```
	 */
	auth<TNewAuth extends AuthConfig>(
		auth: TNewAuth,
	): QCMSBuilder<
		QCMSBuilderState<
			TState["name"],
			TState["collections"],
			TState["globals"],
			TState["jobs"],
			TState["emailTemplates"],
			TState["functions"],
			TNewAuth
		>
	> {
		return new QCMSBuilder({
			...this.state,
			auth,
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
	): QCMSBuilder<Omit<TState, "locale"> & { locale: LocaleConfig }> {
		return new QCMSBuilder({
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
	): QCMSBuilder<Omit<TState, "migrations"> & { migrations: Migration[] }> {
		return new QCMSBuilder({
			...this.state,
			migrations: [...(this.state.migrations || []), ...migrations],
		} as any);
	}

	/**
	 * Use (compose) another QCMS builder (module composition)
	 * Override strategy: Last wins for all properties
	 *
	 * @example
	 * ```ts
	 * // Simple module composition
	 * const blogModule = defineQCMS({ name: 'blog' })
	 *   .collections({
	 *     posts: postsCollection,
	 *     categories: categoriesCollection,
	 *   })
	 *   .jobs({
	 *     publishPost: publishPostJob,
	 *   })
	 *
	 * const cms = defineQCMS({ name: 'app' })
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
	 * const blogModule = defineQCMS({ name: 'blog' })
	 *   .collections({ posts: postsCollection })
	 *
	 * const cms = defineQCMS({ name: 'app' })
	 *   .use(blogModule)
	 *   .collections({
	 *     // Override posts collection with custom fields
	 *     posts: blogModule.state.collections.posts.merge(
	 *       defineCollection("posts").fields({
	 *         featured: boolean("featured").default(false),
	 *         viewCount: integer("view_count").default(0),
	 *       })
	 *     )
	 *   })
	 * ```
	 */
	use<TOtherState extends QCMSBuilderState>(
		other: QCMSBuilder<TOtherState>,
	): QCMSBuilder<
		QCMSBuilderState<
			TState["name"],
			Omit<TState["collections"], keyof TOtherState["collections"]> &
				TOtherState["collections"],
			Omit<TState["globals"], keyof TOtherState["globals"]> &
				TOtherState["globals"],
			Omit<TState["jobs"], keyof TOtherState["jobs"]> & TOtherState["jobs"],
			Omit<TState["emailTemplates"], keyof TOtherState["emailTemplates"]> &
				TOtherState["emailTemplates"],
			Omit<TState["functions"], keyof TOtherState["functions"]> &
				TOtherState["functions"],
			TOtherState["auth"] extends undefined
				? TState["auth"]
				: TOtherState["auth"]
		> & {
			locale: TOtherState["locale"] extends undefined
				? TState["locale"]
				: TOtherState["locale"];
			migrations: Migration[];
		}
	> {
		const otherState = (other as any).state as TOtherState;

		return new QCMSBuilder({
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
			functions: {
				...this.state.functions,
				...otherState.functions,
			},
			// Override strategy: Last wins (module overrides if defined)
			auth: otherState.auth ?? this.state.auth,
			locale: otherState.locale ?? this.state.locale,
			migrations: [
				...(this.state.migrations || []),
				...(otherState.migrations || []),
			],
		} as any);
	}

	/**
	 * Build the final QCMS instance
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
	build<TDbConfig extends CMSDbConfig = CMSDbConfig>(
		runtimeConfig: QCMSRuntimeConfig<TDbConfig>,
	): QCMSFromState<TState> {
		// Build CMSConfig with object-based collections, globals, jobs, templates
		const cmsConfig: CMSConfig = {
			app: runtimeConfig.app,
			db: runtimeConfig.db,
			secret: runtimeConfig.secret,
			collections: this.state.collections,
			globals: this.state.globals,
			functions: this.state.functions,
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
				directory: runtimeConfig.migrations?.directory,
				migrations: this.state.migrations,
			},
		};

		return new QCMS(cmsConfig) as any;
	}
}

/**
 * Helper function to start building a QCMS instance
 *
 * Core collections (assets, auth tables) are automatically included
 * and can be extended or overridden via .collections()
 *
 * @example
 * ```ts
 * const cms = defineQCMS({ name: 'my-app' })
 *   .collections({ posts: postsCollection })
 *   .build({ ... })
 * ```
 *
 * @example
 * ```ts
 * // Extend core assets collection
 * const cms = defineQCMS({ name: 'my-app' })
 *   .collections({
 *     assets: assetsCollection.merge(
 *       defineCollection("assets").fields({
 *         folder: varchar("folder", { length: 255 }),
 *       })
 *     )
 *   })
 *   .build({ ... })
 * ```
 */
export function defineQCMS<TName extends string>(config: { name: TName }) {
	return QCMSBuilder.empty(config.name).use(createCoreModule());
}
