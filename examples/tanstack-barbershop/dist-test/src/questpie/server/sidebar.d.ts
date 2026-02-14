export declare const sidebar: import("questpie").QuestpieBuilder<{
    auth: import("questpie").MergeAuthOptions<{}, import("questpie").MergeAuthOptions<{}, import("questpie").MergeAuthOptions<{}, {
        baseURL: string | undefined;
        secret: string | undefined;
        advanced: {
            useSecureCookies: boolean;
        };
        plugins: [{
            id: "admin";
            init(): {
                options: {
                    databaseHooks: {
                        user: {
                            create: {
                                before(user: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                } & Record<string, unknown>): Promise<{
                                    data: {
                                        id: string;
                                        createdAt: Date;
                                        updatedAt: Date;
                                        email: string;
                                        emailVerified: boolean;
                                        name: string;
                                        image?: string | null | undefined;
                                        role: string;
                                    };
                                }>;
                            };
                        };
                        session: {
                            create: {
                                before(session: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    userId: string;
                                    expiresAt: Date;
                                    token: string;
                                    ipAddress?: string | null | undefined;
                                    userAgent?: string | null | undefined;
                                } & Record<string, unknown>, ctx: import("better-auth").GenericEndpointContext | null): Promise<void>;
                            };
                        };
                    };
                };
            };
            hooks: {
                after: {
                    matcher(context: import("better-auth").HookEndpointContext): boolean;
                    handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<import("better-auth/plugins").SessionWithImpersonatedBy[] | undefined>;
                }[];
            };
            endpoints: {
                setRole: import("better-auth").StrictEndpoint<"/admin/set-role", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                        role: import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>;
                    }, import("better-auth").$strip>;
                    requireHeaders: true;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                        $Infer: {
                            body: {
                                userId: string;
                                role: "admin" | "user" | ("admin" | "user")[];
                            };
                        };
                    };
                }, {
                    user: import("better-auth/plugins").UserWithRole;
                }>;
                getUser: import("better-auth").StrictEndpoint<"/admin/get-user", {
                    method: "GET";
                    query: import("better-auth").ZodObject<{
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, import("better-auth/plugins").UserWithRole>;
                createUser: import("better-auth").StrictEndpoint<"/admin/create-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        email: import("better-auth").ZodString;
                        password: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        name: import("better-auth").ZodString;
                        role: import("better-auth").ZodOptional<import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>>;
                        data: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodAny>>;
                    }, import("better-auth").$strip>;
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                        $Infer: {
                            body: {
                                email: string;
                                password?: string | undefined;
                                name: string;
                                role?: "admin" | "user" | ("admin" | "user")[] | undefined;
                                data?: Record<string, any> | undefined;
                            };
                        };
                    };
                }, {
                    user: import("better-auth/plugins").UserWithRole;
                }>;
                adminUpdateUser: import("better-auth").StrictEndpoint<"/admin/update-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                        data: import("better-auth").ZodRecord<import("better-auth").ZodAny, import("better-auth").ZodAny>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, import("better-auth/plugins").UserWithRole>;
                listUsers: import("better-auth").StrictEndpoint<"/admin/list-users", {
                    method: "GET";
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    query: import("better-auth").ZodObject<{
                        searchValue: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        searchField: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                            name: "name";
                            email: "email";
                        }>>;
                        searchOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                            contains: "contains";
                            starts_with: "starts_with";
                            ends_with: "ends_with";
                        }>>;
                        limit: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                        offset: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                        sortBy: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        sortDirection: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                            asc: "asc";
                            desc: "desc";
                        }>>;
                        filterField: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        filterValue: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>, import("better-auth").ZodBoolean]>>;
                        filterOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                            eq: "eq";
                            ne: "ne";
                            lt: "lt";
                            lte: "lte";
                            gt: "gt";
                            gte: "gte";
                            contains: "contains";
                        }>>;
                    }, import("better-auth").$strip>;
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    users: {
                                                        type: string;
                                                        items: {
                                                            $ref: string;
                                                        };
                                                    };
                                                    total: {
                                                        type: string;
                                                    };
                                                    limit: {
                                                        type: string;
                                                    };
                                                    offset: {
                                                        type: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    users: import("better-auth/plugins").UserWithRole[];
                    total: number;
                    limit: number | undefined;
                    offset: number | undefined;
                } | {
                    users: never[];
                    total: number;
                }>;
                listUserSessions: import("better-auth").StrictEndpoint<"/admin/list-user-sessions", {
                    method: "POST";
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    sessions: {
                                                        type: string;
                                                        items: {
                                                            $ref: string;
                                                        };
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    sessions: import("better-auth/plugins").SessionWithImpersonatedBy[];
                }>;
                unbanUser: import("better-auth").StrictEndpoint<"/admin/unban-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    user: import("better-auth/plugins").UserWithRole;
                }>;
                banUser: import("better-auth").StrictEndpoint<"/admin/ban-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                        banReason: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        banExpiresIn: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    user: import("better-auth/plugins").UserWithRole;
                }>;
                impersonateUser: import("better-auth").StrictEndpoint<"/admin/impersonate-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    session: {
                                                        $ref: string;
                                                    };
                                                    user: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    session: {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        userId: string;
                        expiresAt: Date;
                        token: string;
                        ipAddress?: string | null | undefined;
                        userAgent?: string | null | undefined;
                    };
                    user: import("better-auth/plugins").UserWithRole;
                }>;
                stopImpersonating: import("better-auth").StrictEndpoint<"/admin/stop-impersonating", {
                    method: "POST";
                    requireHeaders: true;
                }, {
                    session: {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        userId: string;
                        expiresAt: Date;
                        token: string;
                        ipAddress?: string | null | undefined;
                        userAgent?: string | null | undefined;
                    } & Record<string, any>;
                    user: {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        email: string;
                        emailVerified: boolean;
                        name: string;
                        image?: string | null | undefined;
                    } & Record<string, any>;
                }>;
                revokeUserSession: import("better-auth").StrictEndpoint<"/admin/revoke-user-session", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        sessionToken: import("better-auth").ZodString;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    success: {
                                                        type: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    success: boolean;
                }>;
                revokeUserSessions: import("better-auth").StrictEndpoint<"/admin/revoke-user-sessions", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    success: {
                                                        type: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    success: boolean;
                }>;
                removeUser: import("better-auth").StrictEndpoint<"/admin/remove-user", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    success: {
                                                        type: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    success: boolean;
                }>;
                setUserPassword: import("better-auth").StrictEndpoint<"/admin/set-user-password", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        newPassword: import("better-auth").ZodString;
                        userId: import("better-auth").ZodCoercedString<unknown>;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            user: import("better-auth/plugins").UserWithRole;
                            session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            operationId: string;
                            summary: string;
                            description: string;
                            responses: {
                                200: {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    status: {
                                                        type: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    status: boolean;
                }>;
                userHasPermission: import("better-auth").StrictEndpoint<"/admin/has-permission", {
                    method: "POST";
                    body: import("better-auth").ZodIntersection<import("better-auth").ZodObject<{
                        userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                        role: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    }, import("better-auth").$strip>, import("better-auth").ZodUnion<readonly [import("better-auth").ZodObject<{
                        permission: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                        permissions: import("better-auth").ZodUndefined;
                    }, import("better-auth").$strip>, import("better-auth").ZodObject<{
                        permission: import("better-auth").ZodUndefined;
                        permissions: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                    }, import("better-auth").$strip>]>>;
                    metadata: {
                        openapi: {
                            description: string;
                            requestBody: {
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                permission: {
                                                    type: string;
                                                    description: string;
                                                    deprecated: boolean;
                                                };
                                                permissions: {
                                                    type: string;
                                                    description: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    error: {
                                                        type: string;
                                                    };
                                                    success: {
                                                        type: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                        $Infer: {
                            body: ({
                                permission: {
                                    readonly user?: ("ban" | "create" | "delete" | "get" | "impersonate" | "list" | "set-password" | "set-role" | "update")[] | undefined;
                                    readonly session?: ("delete" | "list" | "revoke")[] | undefined;
                                };
                                permissions?: undefined;
                            } | {
                                permissions: {
                                    readonly user?: ("ban" | "create" | "delete" | "get" | "impersonate" | "list" | "set-password" | "set-role" | "update")[] | undefined;
                                    readonly session?: ("delete" | "list" | "revoke")[] | undefined;
                                };
                                permission?: undefined;
                            }) & {
                                userId?: string | undefined;
                                role?: "admin" | "user" | undefined;
                            };
                        };
                    };
                }, {
                    error: null;
                    success: boolean;
                }>;
            };
            $ERROR_CODES: {
                readonly FAILED_TO_CREATE_USER: "Failed to create user";
                readonly USER_ALREADY_EXISTS: "User already exists.";
                readonly USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "User already exists. Use another email.";
                readonly YOU_CANNOT_BAN_YOURSELF: "You cannot ban yourself";
                readonly YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: "You are not allowed to change users role";
                readonly YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: "You are not allowed to create users";
                readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: "You are not allowed to list users";
                readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: "You are not allowed to list users sessions";
                readonly YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: "You are not allowed to ban users";
                readonly YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: "You are not allowed to impersonate users";
                readonly YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: "You are not allowed to revoke users sessions";
                readonly YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: "You are not allowed to delete users";
                readonly YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: "You are not allowed to set users password";
                readonly BANNED_USER: "You have been banned from this application";
                readonly YOU_ARE_NOT_ALLOWED_TO_GET_USER: "You are not allowed to get user";
                readonly NO_DATA_TO_UPDATE: "No data to update";
                readonly YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: "You are not allowed to update users";
                readonly YOU_CANNOT_REMOVE_YOURSELF: "You cannot remove yourself";
                readonly YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: "You are not allowed to set a non-existent role value";
                readonly YOU_CANNOT_IMPERSONATE_ADMINS: "You cannot impersonate admins";
                readonly INVALID_ROLE_TYPE: "Invalid role type";
            };
            schema: {
                user: {
                    fields: {
                        role: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        banned: {
                            type: "boolean";
                            defaultValue: false;
                            required: false;
                            input: false;
                        };
                        banReason: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        banExpires: {
                            type: "date";
                            required: false;
                            input: false;
                        };
                    };
                };
                session: {
                    fields: {
                        impersonatedBy: {
                            type: "string";
                            required: false;
                        };
                    };
                };
            };
            options: NoInfer<import("better-auth/plugins").AdminOptions>;
        }, {
            id: "api-key";
            $ERROR_CODES: {
                readonly INVALID_METADATA_TYPE: "metadata must be an object or undefined";
                readonly REFILL_AMOUNT_AND_INTERVAL_REQUIRED: "refillAmount is required when refillInterval is provided";
                readonly REFILL_INTERVAL_AND_AMOUNT_REQUIRED: "refillInterval is required when refillAmount is provided";
                readonly USER_BANNED: "User is banned";
                readonly UNAUTHORIZED_SESSION: "Unauthorized or invalid session";
                readonly KEY_NOT_FOUND: "API Key not found";
                readonly KEY_DISABLED: "API Key is disabled";
                readonly KEY_EXPIRED: "API Key has expired";
                readonly USAGE_EXCEEDED: "API Key has reached its usage limit";
                readonly KEY_NOT_RECOVERABLE: "API Key is not recoverable";
                readonly EXPIRES_IN_IS_TOO_SMALL: "The expiresIn is smaller than the predefined minimum value.";
                readonly EXPIRES_IN_IS_TOO_LARGE: "The expiresIn is larger than the predefined maximum value.";
                readonly INVALID_REMAINING: "The remaining count is either too large or too small.";
                readonly INVALID_PREFIX_LENGTH: "The prefix length is either too large or too small.";
                readonly INVALID_NAME_LENGTH: "The name length is either too large or too small.";
                readonly METADATA_DISABLED: "Metadata is disabled.";
                readonly RATE_LIMIT_EXCEEDED: "Rate limit exceeded.";
                readonly NO_VALUES_TO_UPDATE: "No values to update.";
                readonly KEY_DISABLED_EXPIRATION: "Custom key expiration values are disabled.";
                readonly INVALID_API_KEY: "Invalid API key.";
                readonly INVALID_USER_ID_FROM_API_KEY: "The user id from the API key is invalid.";
                readonly INVALID_API_KEY_GETTER_RETURN_TYPE: "API Key getter returned an invalid key type. Expected string.";
                readonly SERVER_ONLY_PROPERTY: "The property you're trying to set can only be set from the server auth instance only.";
                readonly FAILED_TO_UPDATE_API_KEY: "Failed to update API key";
                readonly NAME_REQUIRED: "API Key name is required.";
            };
            hooks: {
                before: {
                    matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                    handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        user: {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            email: string;
                            emailVerified: boolean;
                            name: string;
                            image?: string | null | undefined;
                        };
                        session: {
                            id: string;
                            token: string;
                            userId: string;
                            userAgent: string | null;
                            ipAddress: string | null;
                            createdAt: Date;
                            updatedAt: Date;
                            expiresAt: Date;
                        };
                    } | {
                        context: import("better-auth").MiddlewareContext<import("better-auth").MiddlewareOptions, {
                            returned?: unknown;
                            responseHeaders?: Headers | undefined;
                        } & import("better-auth").PluginContext & import("better-auth").InfoContext & {
                            options: import("better-auth").BetterAuthOptions;
                            appName: string;
                            baseURL: string;
                            trustedOrigins: string[];
                            isTrustedOrigin: (url: string, settings?: {
                                allowRelativePaths: boolean;
                            } | undefined) => boolean;
                            oauthConfig: {
                                skipStateCookieCheck?: boolean | undefined;
                                storeStateStrategy: "cookie" | "database";
                            };
                            newSession: {
                                session: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    userId: string;
                                    expiresAt: Date;
                                    token: string;
                                    ipAddress?: string | null | undefined;
                                    userAgent?: string | null | undefined;
                                } & Record<string, any>;
                                user: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                } & Record<string, any>;
                            } | null;
                            session: {
                                session: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    userId: string;
                                    expiresAt: Date;
                                    token: string;
                                    ipAddress?: string | null | undefined;
                                    userAgent?: string | null | undefined;
                                } & Record<string, any>;
                                user: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                } & Record<string, any>;
                            } | null;
                            setNewSession: (session: {
                                session: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    userId: string;
                                    expiresAt: Date;
                                    token: string;
                                    ipAddress?: string | null | undefined;
                                    userAgent?: string | null | undefined;
                                } & Record<string, any>;
                                user: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                } & Record<string, any>;
                            } | null) => void;
                            socialProviders: import("better-auth").OAuthProvider<Record<string, any>, Partial<import("better-auth").ProviderOptions<any>>>[];
                            authCookies: import("better-auth").BetterAuthCookies;
                            logger: import("better-auth").InternalLogger;
                            rateLimit: {
                                enabled: boolean;
                                window: number;
                                max: number;
                                storage: "database" | "memory" | "secondary-storage";
                            } & Omit<import("better-auth").BetterAuthRateLimitOptions, "enabled" | "max" | "storage" | "window">;
                            adapter: import("better-auth").DBAdapter<import("better-auth").BetterAuthOptions>;
                            internalAdapter: import("better-auth").InternalAdapter<import("better-auth").BetterAuthOptions>;
                            createAuthCookie: (cookieName: string, overrideAttributes?: Partial<import("better-auth").CookieOptions> | undefined) => import("better-auth").BetterAuthCookie;
                            secret: string;
                            sessionConfig: {
                                updateAge: number;
                                expiresIn: number;
                                freshAge: number;
                                cookieRefreshCache: false | {
                                    enabled: true;
                                    updateAge: number;
                                };
                            };
                            generateId: (options: {
                                model: import("better-auth").ModelNames;
                                size?: number | undefined;
                            }) => string | false;
                            secondaryStorage: import("better-auth").SecondaryStorage | undefined;
                            password: {
                                hash: (password: string) => Promise<string>;
                                verify: (data: {
                                    password: string;
                                    hash: string;
                                }) => Promise<boolean>;
                                config: {
                                    minPasswordLength: number;
                                    maxPasswordLength: number;
                                };
                                checkPassword: (userId: string, ctx: import("better-auth").GenericEndpointContext<import("better-auth").BetterAuthOptions>) => Promise<boolean>;
                            };
                            tables: import("better-auth").BetterAuthDBSchema;
                            runMigrations: () => Promise<void>;
                            publishTelemetry: (event: {
                                type: string;
                                anonymousId?: string | undefined;
                                payload: Record<string, any>;
                            }) => Promise<void>;
                            skipOriginCheck: boolean | string[];
                            skipCSRFCheck: boolean;
                            runInBackground: (promise: Promise<unknown>) => void;
                            runInBackgroundOrAwait: (promise: void | Promise<unknown>) => unknown;
                        }>;
                    }>;
                }[];
            };
            endpoints: {
                createApiKey: import("better-auth").StrictEndpoint<"/api-key/create", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        name: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        expiresIn: import("better-auth").ZodDefault<import("better-auth").ZodNullable<import("better-auth").ZodOptional<import("better-auth").ZodNumber>>>;
                        userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                        prefix: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        remaining: import("better-auth").ZodDefault<import("better-auth").ZodNullable<import("better-auth").ZodOptional<import("better-auth").ZodNumber>>>;
                        metadata: import("better-auth").ZodOptional<import("better-auth").ZodAny>;
                        refillAmount: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        refillInterval: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        rateLimitTimeWindow: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        rateLimitMax: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        rateLimitEnabled: import("better-auth").ZodOptional<import("better-auth").ZodBoolean>;
                        permissions: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>>;
                    }, import("better-auth").$strip>;
                    metadata: {
                        openapi: {
                            description: string;
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    id: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    createdAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    updatedAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    name: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    prefix: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    start: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    key: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    enabled: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    expiresAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    userId: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    lastRefillAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    lastRequest: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    metadata: {
                                                        type: string;
                                                        nullable: boolean;
                                                        additionalProperties: boolean;
                                                        description: string;
                                                    };
                                                    rateLimitMax: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    rateLimitTimeWindow: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    remaining: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    refillAmount: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    refillInterval: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    rateLimitEnabled: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    requestCount: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    permissions: {
                                                        type: string;
                                                        nullable: boolean;
                                                        additionalProperties: {
                                                            type: string;
                                                            items: {
                                                                type: string;
                                                            };
                                                        };
                                                        description: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    key: string;
                    metadata: any;
                    permissions: any;
                    id: string;
                    name: string | null;
                    start: string | null;
                    prefix: string | null;
                    userId: string;
                    refillInterval: number | null;
                    refillAmount: number | null;
                    lastRefillAt: Date | null;
                    enabled: boolean;
                    rateLimitEnabled: boolean;
                    rateLimitTimeWindow: number | null;
                    rateLimitMax: number | null;
                    requestCount: number;
                    remaining: number | null;
                    lastRequest: Date | null;
                    expiresAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                }>;
                verifyApiKey: import("better-auth").StrictEndpoint<string, {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        key: import("better-auth").ZodString;
                        permissions: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>>;
                    }, import("better-auth").$strip>;
                }, {
                    valid: boolean;
                    error: {
                        message: string | undefined;
                        code: string;
                    };
                    key: null;
                } | {
                    valid: boolean;
                    error: null;
                    key: Omit<import("better-auth/plugins").ApiKey, "key"> | null;
                }>;
                getApiKey: import("better-auth").StrictEndpoint<"/api-key/get", {
                    method: "GET";
                    query: import("better-auth").ZodObject<{
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            session: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                            user: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            description: string;
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    id: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    name: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    start: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    prefix: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    userId: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    refillInterval: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    refillAmount: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    lastRefillAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    enabled: {
                                                        type: string;
                                                        description: string;
                                                        default: boolean;
                                                    };
                                                    rateLimitEnabled: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    rateLimitTimeWindow: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    rateLimitMax: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    requestCount: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    remaining: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    lastRequest: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    expiresAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    createdAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    updatedAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    metadata: {
                                                        type: string;
                                                        nullable: boolean;
                                                        additionalProperties: boolean;
                                                        description: string;
                                                    };
                                                    permissions: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    metadata: Record<string, any> | null;
                    permissions: {
                        [key: string]: string[];
                    } | null;
                    id: string;
                    name: string | null;
                    start: string | null;
                    prefix: string | null;
                    userId: string;
                    refillInterval: number | null;
                    refillAmount: number | null;
                    lastRefillAt: Date | null;
                    enabled: boolean;
                    rateLimitEnabled: boolean;
                    rateLimitTimeWindow: number | null;
                    rateLimitMax: number | null;
                    requestCount: number;
                    remaining: number | null;
                    lastRequest: Date | null;
                    expiresAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                }>;
                updateApiKey: import("better-auth").StrictEndpoint<"/api-key/update", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        keyId: import("better-auth").ZodString;
                        userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                        name: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                        enabled: import("better-auth").ZodOptional<import("better-auth").ZodBoolean>;
                        remaining: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        refillAmount: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        refillInterval: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        metadata: import("better-auth").ZodOptional<import("better-auth").ZodAny>;
                        expiresIn: import("better-auth").ZodNullable<import("better-auth").ZodOptional<import("better-auth").ZodNumber>>;
                        rateLimitEnabled: import("better-auth").ZodOptional<import("better-auth").ZodBoolean>;
                        rateLimitTimeWindow: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        rateLimitMax: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                        permissions: import("better-auth").ZodNullable<import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>>>;
                    }, import("better-auth").$strip>;
                    metadata: {
                        openapi: {
                            description: string;
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    id: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    name: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    start: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    prefix: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    userId: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    refillInterval: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    refillAmount: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    lastRefillAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    enabled: {
                                                        type: string;
                                                        description: string;
                                                        default: boolean;
                                                    };
                                                    rateLimitEnabled: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    rateLimitTimeWindow: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    rateLimitMax: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    requestCount: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                    remaining: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    lastRequest: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    expiresAt: {
                                                        type: string;
                                                        format: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                    createdAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    updatedAt: {
                                                        type: string;
                                                        format: string;
                                                        description: string;
                                                    };
                                                    metadata: {
                                                        type: string;
                                                        nullable: boolean;
                                                        additionalProperties: boolean;
                                                        description: string;
                                                    };
                                                    permissions: {
                                                        type: string;
                                                        nullable: boolean;
                                                        description: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    metadata: Record<string, any> | null;
                    permissions: {
                        [key: string]: string[];
                    } | null;
                    id: string;
                    name: string | null;
                    start: string | null;
                    prefix: string | null;
                    userId: string;
                    refillInterval: number | null;
                    refillAmount: number | null;
                    lastRefillAt: Date | null;
                    enabled: boolean;
                    rateLimitEnabled: boolean;
                    rateLimitTimeWindow: number | null;
                    rateLimitMax: number | null;
                    requestCount: number;
                    remaining: number | null;
                    lastRequest: Date | null;
                    expiresAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                }>;
                deleteApiKey: import("better-auth").StrictEndpoint<"/api-key/delete", {
                    method: "POST";
                    body: import("better-auth").ZodObject<{
                        keyId: import("better-auth").ZodString;
                    }, import("better-auth").$strip>;
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            session: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                            user: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            description: string;
                            requestBody: {
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                keyId: {
                                                    type: string;
                                                    description: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "object";
                                                properties: {
                                                    success: {
                                                        type: string;
                                                        description: string;
                                                    };
                                                };
                                                required: string[];
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    success: boolean;
                }>;
                listApiKeys: import("better-auth").StrictEndpoint<"/api-key/list", {
                    method: "GET";
                    use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        session: {
                            session: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            };
                            user: Record<string, any> & {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            };
                        };
                    }>)[];
                    metadata: {
                        openapi: {
                            description: string;
                            responses: {
                                "200": {
                                    description: string;
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "array";
                                                items: {
                                                    type: string;
                                                    properties: {
                                                        id: {
                                                            type: string;
                                                            description: string;
                                                        };
                                                        name: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        start: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        prefix: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        userId: {
                                                            type: string;
                                                            description: string;
                                                        };
                                                        refillInterval: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        refillAmount: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        lastRefillAt: {
                                                            type: string;
                                                            format: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        enabled: {
                                                            type: string;
                                                            description: string;
                                                            default: boolean;
                                                        };
                                                        rateLimitEnabled: {
                                                            type: string;
                                                            description: string;
                                                        };
                                                        rateLimitTimeWindow: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        rateLimitMax: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        requestCount: {
                                                            type: string;
                                                            description: string;
                                                        };
                                                        remaining: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        lastRequest: {
                                                            type: string;
                                                            format: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        expiresAt: {
                                                            type: string;
                                                            format: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                        createdAt: {
                                                            type: string;
                                                            format: string;
                                                            description: string;
                                                        };
                                                        updatedAt: {
                                                            type: string;
                                                            format: string;
                                                            description: string;
                                                        };
                                                        metadata: {
                                                            type: string;
                                                            nullable: boolean;
                                                            additionalProperties: boolean;
                                                            description: string;
                                                        };
                                                        permissions: {
                                                            type: string;
                                                            nullable: boolean;
                                                            description: string;
                                                        };
                                                    };
                                                    required: string[];
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                }, {
                    metadata: Record<string, any> | null;
                    permissions: {
                        [key: string]: string[];
                    } | null;
                    id: string;
                    name: string | null;
                    start: string | null;
                    prefix: string | null;
                    userId: string;
                    refillInterval: number | null;
                    refillAmount: number | null;
                    lastRefillAt: Date | null;
                    enabled: boolean;
                    rateLimitEnabled: boolean;
                    rateLimitTimeWindow: number | null;
                    rateLimitMax: number | null;
                    requestCount: number;
                    remaining: number | null;
                    lastRequest: Date | null;
                    expiresAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                }[]>;
                deleteAllExpiredApiKeys: import("better-auth").StrictEndpoint<string, {
                    method: "POST";
                }, {
                    success: boolean;
                    error: unknown;
                }>;
            };
            schema: {
                apikey: {
                    fields: {
                        name: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        start: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        prefix: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        key: {
                            type: "string";
                            required: true;
                            input: false;
                            index: true;
                        };
                        userId: {
                            type: "string";
                            references: {
                                model: string;
                                field: string;
                                onDelete: "cascade";
                            };
                            required: true;
                            input: false;
                            index: true;
                        };
                        refillInterval: {
                            type: "number";
                            required: false;
                            input: false;
                        };
                        refillAmount: {
                            type: "number";
                            required: false;
                            input: false;
                        };
                        lastRefillAt: {
                            type: "date";
                            required: false;
                            input: false;
                        };
                        enabled: {
                            type: "boolean";
                            required: false;
                            input: false;
                            defaultValue: true;
                        };
                        rateLimitEnabled: {
                            type: "boolean";
                            required: false;
                            input: false;
                            defaultValue: true;
                        };
                        rateLimitTimeWindow: {
                            type: "number";
                            required: false;
                            input: false;
                            defaultValue: number;
                        };
                        rateLimitMax: {
                            type: "number";
                            required: false;
                            input: false;
                            defaultValue: number;
                        };
                        requestCount: {
                            type: "number";
                            required: false;
                            input: false;
                            defaultValue: number;
                        };
                        remaining: {
                            type: "number";
                            required: false;
                            input: false;
                        };
                        lastRequest: {
                            type: "date";
                            required: false;
                            input: false;
                        };
                        expiresAt: {
                            type: "date";
                            required: false;
                            input: false;
                        };
                        createdAt: {
                            type: "date";
                            required: true;
                            input: false;
                        };
                        updatedAt: {
                            type: "date";
                            required: true;
                            input: false;
                        };
                        permissions: {
                            type: "string";
                            required: false;
                            input: false;
                        };
                        metadata: {
                            type: "string";
                            required: false;
                            input: true;
                            transform: {
                                input(value: import("better-auth").DBPrimitive): string;
                                output(value: import("better-auth").DBPrimitive): any;
                            };
                        };
                    };
                };
            };
            options: import("better-auth/plugins").ApiKeyOptions | undefined;
        }, {
            id: "bearer";
            hooks: {
                before: {
                    matcher(context: import("better-auth").HookEndpointContext): boolean;
                    handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                        context: {
                            headers: Headers;
                        };
                    } | undefined>;
                }[];
                after: {
                    matcher(context: import("better-auth").HookEndpointContext): true;
                    handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>;
                }[];
            };
            options: import("better-auth/plugins").BearerOptions | undefined;
        }];
        emailAndPassword: {
            enabled: true;
            requireEmailVerification: true;
        };
    }>>>;
    collections: import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, "account" | "adminLocks" | "adminPreferences" | "adminSavedViews" | "apikey" | "assets" | "session" | "user" | "verification">, {
        account: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly userId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly accountId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly providerId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly accessToken: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly refreshToken: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly accessTokenExpiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly refreshTokenExpiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly scope: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly idToken: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly password: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly userId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly accountId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly providerId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly accessToken: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly refreshToken: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly accessTokenExpiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly refreshTokenExpiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly scope: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly idToken: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly password: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "account";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "providerId";
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        adminLocks: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly resourceType: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"select", {
                    readonly required: true;
                    readonly options: readonly [{
                        readonly value: "collection";
                        readonly label: "Collection";
                    }, {
                        readonly value: "global";
                        readonly label: "Global";
                    }];
                    readonly label: "Resource Type";
                }, string | string[], import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                } | {
                    column: {
                        containsAll: import("questpie").OperatorFn<string[], unknown>;
                        containsAny: import("questpie").OperatorFn<string[], unknown>;
                        eq: import("questpie").OperatorFn<string[], unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        length: import("questpie").OperatorFn<number, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        containsAll: import("questpie").OperatorFn<string[], unknown>;
                        containsAny: import("questpie").OperatorFn<string[], unknown>;
                        eq: import("questpie").OperatorFn<string[], unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        length: import("questpie").OperatorFn<number, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly resource: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "Resource";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly resourceId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "Resource ID";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly user: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"relation", {
                    readonly to: "user";
                    readonly required: true;
                    readonly label: "User";
                }, string | string[] | {
                    type: string;
                    id: string;
                } | null, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                } | {
                    column: {
                        contains: import("questpie").OperatorFn<string, unknown>;
                        containsAll: import("questpie").OperatorFn<string[], unknown>;
                        containsAny: import("questpie").OperatorFn<string[], unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        count: import("questpie").OperatorFn<number, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        contains: import("questpie").OperatorFn<string, unknown>;
                        containsAll: import("questpie").OperatorFn<string[], unknown>;
                        containsAny: import("questpie").OperatorFn<string[], unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        count: import("questpie").OperatorFn<number, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                } | {
                    column: {
                        some: import("questpie").OperatorFn<unknown, unknown>;
                        none: import("questpie").OperatorFn<unknown, unknown>;
                        every: import("questpie").OperatorFn<unknown, unknown>;
                        count: import("questpie").OperatorFn<number, unknown>;
                    };
                    jsonb: {
                        some: import("questpie").OperatorFn<unknown, unknown>;
                        none: import("questpie").OperatorFn<unknown, unknown>;
                        every: import("questpie").OperatorFn<unknown, unknown>;
                        count: import("questpie").OperatorFn<number, unknown>;
                    };
                }>>;
                readonly sessionId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 64;
                    readonly label: "Session ID";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly expiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"date", {
                    readonly required: true;
                    readonly label: "Expires At";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        gt: import("questpie").OperatorFn<string, unknown>;
                        gte: import("questpie").OperatorFn<string, unknown>;
                        lt: import("questpie").OperatorFn<string, unknown>;
                        lte: import("questpie").OperatorFn<string, unknown>;
                        between: import("questpie").OperatorFn<[string, string], unknown>;
                        before: import("questpie").OperatorFn<string, unknown>;
                        after: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        gt: import("questpie").OperatorFn<string, unknown>;
                        gte: import("questpie").OperatorFn<string, unknown>;
                        lt: import("questpie").OperatorFn<string, unknown>;
                        lte: import("questpie").OperatorFn<string, unknown>;
                        between: import("questpie").OperatorFn<[string, string], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly resourceType: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly resource: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly resourceId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly user: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly sessionId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly expiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "admin_locks";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: undefined;
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        adminPreferences: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly userId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "User ID";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly key: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "Key";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly value: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"json", {
                    readonly required: true;
                    readonly label: "Value";
                }, string | number | boolean | import("questpie").JsonValue[] | {
                    [key: string]: import("questpie").JsonValue;
                } | null, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        contains: import("questpie").OperatorFn<unknown, unknown>;
                        containedBy: import("questpie").OperatorFn<unknown, unknown>;
                        hasKey: import("questpie").OperatorFn<string, unknown>;
                        hasKeys: import("questpie").OperatorFn<string[], unknown>;
                        hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                        pathEquals: import("questpie").OperatorFn<{
                            path: string[];
                            val: unknown;
                        }, unknown>;
                        pathExists: import("questpie").OperatorFn<string[], unknown>;
                        jsonPath: import("questpie").OperatorFn<string, unknown>;
                        eq: import("questpie").OperatorFn<unknown, unknown>;
                        ne: import("questpie").OperatorFn<unknown, unknown>;
                        typeof: import("questpie").OperatorFn<string, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        contains: import("questpie").OperatorFn<unknown, unknown>;
                        containedBy: import("questpie").OperatorFn<unknown, unknown>;
                        hasKey: import("questpie").OperatorFn<string, unknown>;
                        eq: import("questpie").OperatorFn<unknown, unknown>;
                        ne: import("questpie").OperatorFn<unknown, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly userId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly key: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly value: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: import("node_modules/drizzle-orm/pg-core").IndexBuilder[];
            localized: readonly string[];
            name: "admin_preferences";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: undefined;
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        adminSavedViews: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly userId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "User ID";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly collectionName: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "Collection Name";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly name: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly label: "Name";
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly configuration: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"json", {
                    readonly required: true;
                    readonly label: "Configuration";
                }, string | number | boolean | import("questpie").JsonValue[] | {
                    [key: string]: import("questpie").JsonValue;
                } | null, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        contains: import("questpie").OperatorFn<unknown, unknown>;
                        containedBy: import("questpie").OperatorFn<unknown, unknown>;
                        hasKey: import("questpie").OperatorFn<string, unknown>;
                        hasKeys: import("questpie").OperatorFn<string[], unknown>;
                        hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                        pathEquals: import("questpie").OperatorFn<{
                            path: string[];
                            val: unknown;
                        }, unknown>;
                        pathExists: import("questpie").OperatorFn<string[], unknown>;
                        jsonPath: import("questpie").OperatorFn<string, unknown>;
                        eq: import("questpie").OperatorFn<unknown, unknown>;
                        ne: import("questpie").OperatorFn<unknown, unknown>;
                        typeof: import("questpie").OperatorFn<string, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        contains: import("questpie").OperatorFn<unknown, unknown>;
                        containedBy: import("questpie").OperatorFn<unknown, unknown>;
                        hasKey: import("questpie").OperatorFn<string, unknown>;
                        eq: import("questpie").OperatorFn<unknown, unknown>;
                        ne: import("questpie").OperatorFn<unknown, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly isDefault: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"boolean", {
                    readonly default: false;
                    readonly label: "Is Default";
                }, boolean, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly userId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly collectionName: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly name: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly configuration: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly isDefault: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "admin_saved_views";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: undefined;
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        apikey: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly name: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly start: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly prefix: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly key: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 500;
                    readonly unique: true;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly userId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly refillInterval: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly refillAmount: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly lastRefillAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly enabled: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"boolean", {
                    readonly default: true;
                }, boolean, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly rateLimitEnabled: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"boolean", {
                    readonly default: true;
                }, boolean, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly rateLimitTimeWindow: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly rateLimitMax: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly requestCount: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", {
                    readonly default: 0;
                }, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly remaining: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly lastRequest: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly expiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly permissions: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"textarea", Record<string, any>, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        notLike: import("questpie").OperatorFn<string, unknown>;
                        notIlike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly metadata: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"textarea", Record<string, any>, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        notLike: import("questpie").OperatorFn<string, unknown>;
                        notIlike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly name: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly start: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly prefix: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly key: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly userId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly refillInterval: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly refillAmount: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly lastRefillAt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly enabled: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly rateLimitEnabled: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly rateLimitTimeWindow: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly rateLimitMax: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly requestCount: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly remaining: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly lastRequest: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly expiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly permissions: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly metadata: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "apikey";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "key";
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        assets: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly width: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly height: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"number", Record<string, any>, number, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        in: import("questpie").OperatorFn<number[], unknown>;
                        notIn: import("questpie").OperatorFn<number[], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<number, unknown>;
                        ne: import("questpie").OperatorFn<number, unknown>;
                        gt: import("questpie").OperatorFn<number, unknown>;
                        gte: import("questpie").OperatorFn<number, unknown>;
                        lt: import("questpie").OperatorFn<number, unknown>;
                        lte: import("questpie").OperatorFn<number, unknown>;
                        between: import("questpie").OperatorFn<[number, number], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly alt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly caption: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"textarea", Record<string, any>, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        notLike: import("questpie").OperatorFn<string, unknown>;
                        notIlike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly width: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly height: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly alt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly caption: import("drizzle-orm/pg-core").AnyPgColumn;
            } & {
                key: import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgVarcharBuilder<[string, ...string[]]>>;
                filename: import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgVarcharBuilder<[string, ...string[]]>>;
                mimeType: import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgVarcharBuilder<[string, ...string[]]>>;
                size: import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>;
                visibility: import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/pg-core").PgVarcharBuilder<["public", "private"]>>>;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: {
                afterDelete: ({ data, app }: import("questpie").HookContext<{
                    _title: string;
                    width: number | null;
                    height: number | null;
                    alt: string | null;
                    caption: string | null;
                    createdAt: Date;
                    filename: string;
                    id: string;
                    key: string;
                    mimeType: string;
                    size: number;
                    updatedAt: Date;
                    url: string;
                    visibility: "private" | "public";
                }, never, "delete", any>) => Promise<void>;
            };
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "assets";
            options: {
                timestamps: true;
            };
            output: import("questpie").TypeMerge<{}, {
                url: string;
            }>;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "filename";
            upload: import("questpie").UploadOptions;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        session: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly userId: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly token: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly unique: true;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly expiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", {
                    readonly required: true;
                }, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly ipAddress: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 45;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly userAgent: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly impersonatedBy: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly userId: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly token: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly expiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly ipAddress: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly userAgent: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly impersonatedBy: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "session";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "token";
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        user: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly name: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly email: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"email", {
                    readonly required: true;
                    readonly maxLength: 255;
                    readonly unique: true;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        notLike: import("questpie").OperatorFn<string, unknown>;
                        notIlike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        domain: import("questpie").OperatorFn<string, unknown>;
                        domainIn: import("questpie").OperatorFn<string[], unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        domain: import("questpie").OperatorFn<string, unknown>;
                    };
                }>>;
                readonly emailVerified: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"boolean", {
                    readonly required: true;
                }, boolean, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly image: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"url", {
                    readonly maxLength: 500;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        notLike: import("questpie").OperatorFn<string, unknown>;
                        notIlike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        host: import("questpie").OperatorFn<string, unknown>;
                        hostIn: import("questpie").OperatorFn<string[], unknown>;
                        protocol: import("questpie").OperatorFn<string, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<string, unknown>;
                        ne: import("questpie").OperatorFn<string, unknown>;
                        in: import("questpie").OperatorFn<string[], unknown>;
                        notIn: import("questpie").OperatorFn<string[], unknown>;
                        like: import("questpie").OperatorFn<string, unknown>;
                        ilike: import("questpie").OperatorFn<string, unknown>;
                        contains: import("questpie").OperatorFn<string, unknown>;
                        startsWith: import("questpie").OperatorFn<string, unknown>;
                        endsWith: import("questpie").OperatorFn<string, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        host: import("questpie").OperatorFn<string, unknown>;
                        protocol: import("questpie").OperatorFn<string, unknown>;
                    };
                }>>;
                readonly role: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 50;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly banned: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"boolean", {
                    readonly default: false;
                }, boolean, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<boolean, unknown>;
                        ne: import("questpie").OperatorFn<boolean, unknown>;
                        is: import("questpie").OperatorFn<boolean, unknown>;
                        isNot: import("questpie").OperatorFn<boolean, unknown>;
                        isTrue: import("questpie").OperatorFn<boolean, unknown>;
                        isFalse: import("questpie").OperatorFn<boolean, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly banReason: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly banExpires: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", Record<string, any>, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly name: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly email: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly emailVerified: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly image: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly role: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly banned: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly banReason: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly banExpires: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "user";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "name";
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
        verification: import("questpie").CollectionBuilder<{
            access: import("questpie").CollectionAccess<any, any>;
            admin: import("node_modules/@questpie/admin/src/server").AdminCollectionConfig | undefined;
            adminActions: import("node_modules/@questpie/admin/src/server").ServerActionsConfig | undefined;
            adminForm: import("node_modules/@questpie/admin/src/server").FormViewConfig | undefined;
            adminList: import("node_modules/@questpie/admin/src/server").ListViewConfig | undefined;
            adminPreview: import("node_modules/@questpie/admin/src/server").PreviewConfig | undefined;
            fieldDefinitions: {
                readonly identifier: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly value: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"text", {
                    readonly required: true;
                    readonly maxLength: 255;
                }, string, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly notLike: import("questpie").OperatorFn<string, unknown>;
                        readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        readonly eq: import("questpie").OperatorFn<string, unknown>;
                        readonly ne: import("questpie").OperatorFn<string, unknown>;
                        readonly in: import("questpie").OperatorFn<string[], unknown>;
                        readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                        readonly like: import("questpie").OperatorFn<string, unknown>;
                        readonly ilike: import("questpie").OperatorFn<string, unknown>;
                        readonly contains: import("questpie").OperatorFn<string, unknown>;
                        readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                        readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                        readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
                readonly expiresAt: import("questpie").FieldDefinition<import("questpie").BuildFieldState<"datetime", {
                    readonly required: true;
                }, Date, import("drizzle-orm/pg-core").AnyPgColumn, {
                    column: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                    jsonb: {
                        eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                        between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                        isNull: import("questpie").OperatorFn<boolean, unknown>;
                        isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    };
                }>>;
            };
            fields: {
                readonly identifier: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly value: import("drizzle-orm/pg-core").AnyPgColumn;
                readonly expiresAt: import("drizzle-orm/pg-core").AnyPgColumn;
            };
            functions: import("node_modules/questpie/src/server/collection/builder/types").CollectionFunctionsMap;
            hooks: import("questpie").CollectionHooks<any, any, any, any>;
            indexes: Record<string, any>;
            localized: readonly string[];
            name: "verification";
            options: {
                timestamps: true;
            };
            output: undefined;
            relations: Record<string, import("questpie").RelationConfig>;
            searchable: undefined;
            title: "identifier";
            upload: undefined;
            validation: undefined;
            virtuals: undefined;
            "~fieldTypes": Record<string, any> & {
                array: {
                    readonly type: "array";
                    readonly _value: unknown[];
                    readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            lengthGt: import("questpie").OperatorFn<number, unknown>;
                            lengthLt: import("questpie").OperatorFn<number, unknown>;
                            lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                            containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                boolean: {
                    readonly type: "boolean";
                    readonly _value: boolean;
                    readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
                    readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<boolean, unknown>;
                            ne: import("questpie").OperatorFn<boolean, unknown>;
                            is: import("questpie").OperatorFn<boolean, unknown>;
                            isNot: import("questpie").OperatorFn<boolean, unknown>;
                            isTrue: import("questpie").OperatorFn<boolean, unknown>;
                            isFalse: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
                };
                date: {
                    readonly type: "date";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                    };
                };
                datetime: {
                    readonly type: "datetime";
                    readonly _value: Date;
                    readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                            between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        precision?: number | undefined;
                        withTimezone?: boolean | undefined;
                    };
                };
                email: {
                    readonly type: "email";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                            domainIn: import("questpie").OperatorFn<string[], unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            domain: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
                };
                json: {
                    readonly type: "json";
                    readonly _value: import("questpie").JsonValue;
                    readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
                    readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            pathExists: import("questpie").OperatorFn<string[], unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            typeof: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            eq: import("questpie").OperatorFn<unknown, unknown>;
                            ne: import("questpie").OperatorFn<unknown, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
                };
                number: {
                    readonly type: "number";
                    readonly _value: number;
                    readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
                    readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            in: import("questpie").OperatorFn<number[], unknown>;
                            notIn: import("questpie").OperatorFn<number[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<number, unknown>;
                            ne: import("questpie").OperatorFn<number, unknown>;
                            gt: import("questpie").OperatorFn<number, unknown>;
                            gte: import("questpie").OperatorFn<number, unknown>;
                            lt: import("questpie").OperatorFn<number, unknown>;
                            lte: import("questpie").OperatorFn<number, unknown>;
                            between: import("questpie").OperatorFn<[number, number], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                        mode?: string | undefined;
                        integer?: boolean | undefined;
                        step?: number | undefined;
                    };
                };
                object: {
                    readonly type: "object";
                    readonly _value: Record<string, unknown>;
                    readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
                    }, import("better-auth").$strip>>>;
                    readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                        column: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                            pathEquals: import("questpie").OperatorFn<{
                                path: string[];
                                val: unknown;
                            }, unknown>;
                            jsonPath: import("questpie").OperatorFn<string, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<unknown, unknown>;
                            containedBy: import("questpie").OperatorFn<unknown, unknown>;
                            hasKey: import("questpie").OperatorFn<string, unknown>;
                            hasKeys: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
                };
                relation: {
                    readonly type: "relation";
                    readonly _value: string | string[] | {
                        type: string;
                        id: string;
                    } | null;
                    readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                        type: import("better-auth").ZodEnum<{
                            [x: string]: string;
                        }>;
                        id: import("better-auth").ZodString;
                    }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            contains: import("questpie").OperatorFn<string, unknown>;
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            some: import("questpie").OperatorFn<unknown, unknown>;
                            none: import("questpie").OperatorFn<unknown, unknown>;
                            every: import("questpie").OperatorFn<unknown, unknown>;
                            count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                select: {
                    readonly type: "select";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                        [x: string]: string;
                    }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            containsAll: import("questpie").OperatorFn<string[], unknown>;
                            containsAny: import("questpie").OperatorFn<string[], unknown>;
                            eq: import("questpie").OperatorFn<string[], unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            length: import("questpie").OperatorFn<number, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
                };
                text: {
                    readonly type: "text";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
                };
                textarea: {
                    readonly type: "textarea";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                            isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
                };
                time: {
                    readonly type: "time";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>() => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            before: import("questpie").OperatorFn<string, unknown>;
                            after: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            gt: import("questpie").OperatorFn<string, unknown>;
                            gte: import("questpie").OperatorFn<string, unknown>;
                            lt: import("questpie").OperatorFn<string, unknown>;
                            lte: import("questpie").OperatorFn<string, unknown>;
                            between: import("questpie").OperatorFn<[string, string], unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                        min?: string | undefined;
                        max?: string | undefined;
                        withSeconds?: boolean | undefined;
                        precision?: number | undefined;
                    };
                };
                upload: {
                    readonly type: "upload";
                    readonly _value: string | string[];
                    readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                        column: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly notLike: import("questpie").OperatorFn<string, unknown>;
                            readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                        jsonb: {
                            readonly eq: import("questpie").OperatorFn<string, unknown>;
                            readonly ne: import("questpie").OperatorFn<string, unknown>;
                            readonly in: import("questpie").OperatorFn<string[], unknown>;
                            readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                            readonly like: import("questpie").OperatorFn<string, unknown>;
                            readonly ilike: import("questpie").OperatorFn<string, unknown>;
                            readonly contains: import("questpie").OperatorFn<string, unknown>;
                            readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                            readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                            readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                        };
                    } | {
                        column: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                        jsonb: {
                            readonly some: import("questpie").OperatorFn<boolean, unknown>;
                            readonly none: import("questpie").OperatorFn<boolean, unknown>;
                            readonly every: import("questpie").OperatorFn<boolean, unknown>;
                            readonly count: import("questpie").OperatorFn<number, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
                };
                url: {
                    readonly type: "url";
                    readonly _value: string;
                    readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
                    readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
                    readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                        column: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            notLike: import("questpie").OperatorFn<string, unknown>;
                            notIlike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            hostIn: import("questpie").OperatorFn<string[], unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                        jsonb: {
                            eq: import("questpie").OperatorFn<string, unknown>;
                            ne: import("questpie").OperatorFn<string, unknown>;
                            in: import("questpie").OperatorFn<string[], unknown>;
                            notIn: import("questpie").OperatorFn<string[], unknown>;
                            like: import("questpie").OperatorFn<string, unknown>;
                            ilike: import("questpie").OperatorFn<string, unknown>;
                            contains: import("questpie").OperatorFn<string, unknown>;
                            startsWith: import("questpie").OperatorFn<string, unknown>;
                            endsWith: import("questpie").OperatorFn<string, unknown>;
                            isNull: import("questpie").OperatorFn<boolean, unknown>;
                            isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                            host: import("questpie").OperatorFn<string, unknown>;
                            protocol: import("questpie").OperatorFn<string, unknown>;
                        };
                    };
                    readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
                };
            };
            "~questpieApp": any;
        }>;
    }>;
    contextResolver: undefined;
    emailTemplates: import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, never>, import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, never>, {}>>;
    fields: import("questpie").TypeMerge<import("questpie").UnsetProperty<{
        array: {
            readonly type: "array";
            readonly _value: unknown[];
            readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
            readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                    containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                    containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    lengthGt: import("questpie").OperatorFn<number, unknown>;
                    lengthLt: import("questpie").OperatorFn<number, unknown>;
                    lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                    containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
        };
        boolean: {
            readonly type: "boolean";
            readonly _value: boolean;
            readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
            readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<boolean, unknown>;
                    ne: import("questpie").OperatorFn<boolean, unknown>;
                    is: import("questpie").OperatorFn<boolean, unknown>;
                    isNot: import("questpie").OperatorFn<boolean, unknown>;
                    isTrue: import("questpie").OperatorFn<boolean, unknown>;
                    isFalse: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<boolean, unknown>;
                    ne: import("questpie").OperatorFn<boolean, unknown>;
                    is: import("questpie").OperatorFn<boolean, unknown>;
                    isNot: import("questpie").OperatorFn<boolean, unknown>;
                    isTrue: import("questpie").OperatorFn<boolean, unknown>;
                    isFalse: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
        };
        date: {
            readonly type: "date";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    before: import("questpie").OperatorFn<string, unknown>;
                    after: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
            };
        };
        datetime: {
            readonly type: "datetime";
            readonly _value: Date;
            readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                    before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
                precision?: number | undefined;
                withTimezone?: boolean | undefined;
            };
        };
        email: {
            readonly type: "email";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    domain: import("questpie").OperatorFn<string, unknown>;
                    domainIn: import("questpie").OperatorFn<string[], unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    domain: import("questpie").OperatorFn<string, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
        };
        json: {
            readonly type: "json";
            readonly _value: import("questpie").JsonValue;
            readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
            readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                    pathEquals: import("questpie").OperatorFn<{
                        path: string[];
                        val: unknown;
                    }, unknown>;
                    pathExists: import("questpie").OperatorFn<string[], unknown>;
                    jsonPath: import("questpie").OperatorFn<string, unknown>;
                    eq: import("questpie").OperatorFn<unknown, unknown>;
                    ne: import("questpie").OperatorFn<unknown, unknown>;
                    typeof: import("questpie").OperatorFn<string, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    eq: import("questpie").OperatorFn<unknown, unknown>;
                    ne: import("questpie").OperatorFn<unknown, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
        };
        number: {
            readonly type: "number";
            readonly _value: number;
            readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
            readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<number, unknown>;
                    ne: import("questpie").OperatorFn<number, unknown>;
                    gt: import("questpie").OperatorFn<number, unknown>;
                    gte: import("questpie").OperatorFn<number, unknown>;
                    lt: import("questpie").OperatorFn<number, unknown>;
                    lte: import("questpie").OperatorFn<number, unknown>;
                    between: import("questpie").OperatorFn<[number, number], unknown>;
                    in: import("questpie").OperatorFn<number[], unknown>;
                    notIn: import("questpie").OperatorFn<number[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<number, unknown>;
                    ne: import("questpie").OperatorFn<number, unknown>;
                    gt: import("questpie").OperatorFn<number, unknown>;
                    gte: import("questpie").OperatorFn<number, unknown>;
                    lt: import("questpie").OperatorFn<number, unknown>;
                    lte: import("questpie").OperatorFn<number, unknown>;
                    between: import("questpie").OperatorFn<[number, number], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                mode?: string | undefined;
                integer?: boolean | undefined;
                step?: number | undefined;
            };
        };
        object: {
            readonly type: "object";
            readonly _value: Record<string, unknown>;
            readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
            }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
            }, import("better-auth").$strip>>>;
            readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                    pathEquals: import("questpie").OperatorFn<{
                        path: string[];
                        val: unknown;
                    }, unknown>;
                    jsonPath: import("questpie").OperatorFn<string, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
        };
        relation: {
            readonly type: "relation";
            readonly _value: string | string[] | {
                type: string;
                id: string;
            } | null;
            readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                type: import("better-auth").ZodEnum<{
                    [x: string]: string;
                }>;
                id: import("better-auth").ZodString;
            }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                type: import("better-auth").ZodEnum<{
                    [x: string]: string;
                }>;
                id: import("better-auth").ZodString;
            }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    contains: import("questpie").OperatorFn<string, unknown>;
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<string, unknown>;
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                };
                jsonb: {
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
        };
        select: {
            readonly type: "select";
            readonly _value: string | string[];
            readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                [x: string]: string;
            }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    eq: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    eq: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
        };
        text: {
            readonly type: "text";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                column: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly notLike: import("questpie").OperatorFn<string, unknown>;
                    readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
        };
        textarea: {
            readonly type: "textarea";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
        };
        time: {
            readonly type: "time";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    before: import("questpie").OperatorFn<string, unknown>;
                    after: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
                withSeconds?: boolean | undefined;
                precision?: number | undefined;
            };
        };
        upload: {
            readonly type: "upload";
            readonly _value: string | string[];
            readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                column: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly notLike: import("questpie").OperatorFn<string, unknown>;
                    readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    readonly some: import("questpie").OperatorFn<boolean, unknown>;
                    readonly none: import("questpie").OperatorFn<boolean, unknown>;
                    readonly every: import("questpie").OperatorFn<boolean, unknown>;
                    readonly count: import("questpie").OperatorFn<number, unknown>;
                };
                jsonb: {
                    readonly some: import("questpie").OperatorFn<boolean, unknown>;
                    readonly none: import("questpie").OperatorFn<boolean, unknown>;
                    readonly every: import("questpie").OperatorFn<boolean, unknown>;
                    readonly count: import("questpie").OperatorFn<number, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
        };
        url: {
            readonly type: "url";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    host: import("questpie").OperatorFn<string, unknown>;
                    hostIn: import("questpie").OperatorFn<string[], unknown>;
                    protocol: import("questpie").OperatorFn<string, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    host: import("questpie").OperatorFn<string, unknown>;
                    protocol: import("questpie").OperatorFn<string, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
        };
    }, "array" | "blocks" | "boolean" | "date" | "datetime" | "email" | "json" | "number" | "object" | "relation" | "richText" | "select" | "text" | "textarea" | "time" | "upload" | "url">, {
        array: {
            readonly type: "array";
            readonly _value: unknown[];
            readonly toColumn: (name: string, config: import("questpie").ArrayFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").ArrayFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>>>>;
            readonly getOperators: <TApp>(config: import("questpie").ArrayFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                    containsAny: import("questpie").OperatorFn<unknown[], unknown>;
                    containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    lengthGt: import("questpie").OperatorFn<number, unknown>;
                    lengthLt: import("questpie").OperatorFn<number, unknown>;
                    lengthBetween: import("questpie").OperatorFn<[number, number], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containsAll: import("questpie").OperatorFn<unknown[], unknown>;
                    containedBy: import("questpie").OperatorFn<unknown[], unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").ArrayFieldConfig) => import("questpie").NestedFieldMetadata;
        };
        blocks: {
            readonly type: "blocks";
            readonly _value: import("node_modules/@questpie/admin/src/server").BlocksDocument;
            readonly toColumn: (_name: string, config: import("node_modules/@questpie/admin/src/server").BlocksFieldConfig) => any;
            readonly toZodSchema: (config: import("node_modules/@questpie/admin/src/server").BlocksFieldConfig) => import("better-auth").ZodType<import("node_modules/@questpie/admin/src/server").BlocksDocument | null | undefined, unknown, import("better-auth").$ZodTypeInternals<import("node_modules/@questpie/admin/src/server").BlocksDocument | null | undefined, unknown>>;
            readonly getOperators: <TApp>() => import("questpie").ContextualOperators<import("questpie").OperatorMap, import("questpie").OperatorMap>;
            readonly getMetadata: (config: import("node_modules/@questpie/admin/src/server").BlocksFieldConfig) => import("questpie").FieldMetadataBase & {
                allowedBlocks?: string[] | undefined;
                minBlocks?: number | undefined;
                maxBlocks?: number | undefined;
                allowNesting: boolean;
                maxDepth: number;
                placeholder?: string | undefined;
            };
        };
        boolean: {
            readonly type: "boolean";
            readonly _value: boolean;
            readonly toColumn: (name: string, config: import("questpie").BooleanFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").BooleanFieldConfig) => import("better-auth").ZodBoolean | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodBoolean>>;
            readonly getOperators: <TApp>(config: import("questpie").BooleanFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<boolean, unknown>;
                    ne: import("questpie").OperatorFn<boolean, unknown>;
                    is: import("questpie").OperatorFn<boolean, unknown>;
                    isNot: import("questpie").OperatorFn<boolean, unknown>;
                    isTrue: import("questpie").OperatorFn<boolean, unknown>;
                    isFalse: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<boolean, unknown>;
                    ne: import("questpie").OperatorFn<boolean, unknown>;
                    is: import("questpie").OperatorFn<boolean, unknown>;
                    isNot: import("questpie").OperatorFn<boolean, unknown>;
                    isTrue: import("questpie").OperatorFn<boolean, unknown>;
                    isFalse: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").BooleanFieldConfig) => import("questpie").FieldMetadataBase;
        };
        date: {
            readonly type: "date";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").DateFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").DateFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    before: import("questpie").OperatorFn<string, unknown>;
                    after: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").DateFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
            };
        };
        datetime: {
            readonly type: "datetime";
            readonly _value: Date;
            readonly toColumn: (name: string, config: import("questpie").DatetimeFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").DatetimeFieldConfig) => import("better-auth").ZodCoercedDate<unknown> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodCoercedDate<unknown>>>;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                    before: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    after: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    ne: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    gte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lt: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    lte: import("questpie").OperatorFn<import("node_modules/questpie/src/shared").DateInput, unknown>;
                    between: import("questpie").OperatorFn<[import("node_modules/questpie/src/shared").DateInput, import("node_modules/questpie/src/shared").DateInput], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").DatetimeFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
                precision?: number | undefined;
                withTimezone?: boolean | undefined;
            };
        };
        email: {
            readonly type: "email";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").EmailFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").EmailFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").EmailFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    domain: import("questpie").OperatorFn<string, unknown>;
                    domainIn: import("questpie").OperatorFn<string[], unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    domain: import("questpie").OperatorFn<string, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").EmailFieldConfig) => import("questpie").FieldMetadataBase;
        };
        json: {
            readonly type: "json";
            readonly _value: import("questpie").JsonValue;
            readonly toColumn: (name: string, config: import("questpie").JsonFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").JsonFieldConfig) => any;
            readonly getOperators: <TApp>(config: import("questpie").JsonFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                    pathEquals: import("questpie").OperatorFn<{
                        path: string[];
                        val: unknown;
                    }, unknown>;
                    pathExists: import("questpie").OperatorFn<string[], unknown>;
                    jsonPath: import("questpie").OperatorFn<string, unknown>;
                    eq: import("questpie").OperatorFn<unknown, unknown>;
                    ne: import("questpie").OperatorFn<unknown, unknown>;
                    typeof: import("questpie").OperatorFn<string, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    eq: import("questpie").OperatorFn<unknown, unknown>;
                    ne: import("questpie").OperatorFn<unknown, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").JsonFieldConfig) => import("questpie").FieldMetadataBase;
        };
        number: {
            readonly type: "number";
            readonly _value: number;
            readonly toColumn: (name: string, config: import("questpie").NumberFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").NumberFieldConfig) => import("better-auth").ZodNumber | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodNumber>>;
            readonly getOperators: <TApp>(config: import("questpie").NumberFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<number, unknown>;
                    ne: import("questpie").OperatorFn<number, unknown>;
                    gt: import("questpie").OperatorFn<number, unknown>;
                    gte: import("questpie").OperatorFn<number, unknown>;
                    lt: import("questpie").OperatorFn<number, unknown>;
                    lte: import("questpie").OperatorFn<number, unknown>;
                    between: import("questpie").OperatorFn<[number, number], unknown>;
                    in: import("questpie").OperatorFn<number[], unknown>;
                    notIn: import("questpie").OperatorFn<number[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<number, unknown>;
                    ne: import("questpie").OperatorFn<number, unknown>;
                    gt: import("questpie").OperatorFn<number, unknown>;
                    gte: import("questpie").OperatorFn<number, unknown>;
                    lt: import("questpie").OperatorFn<number, unknown>;
                    lte: import("questpie").OperatorFn<number, unknown>;
                    between: import("questpie").OperatorFn<[number, number], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").NumberFieldConfig) => import("questpie").FieldMetadataBase & {
                mode?: string | undefined;
                integer?: boolean | undefined;
                step?: number | undefined;
            };
        };
        object: {
            readonly type: "object";
            readonly _value: Record<string, unknown>;
            readonly toColumn: (name: string, config: import("questpie").ObjectFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").ObjectFieldConfig) => import("better-auth").ZodObject<{
                [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
            }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                [x: string]: import("better-auth").ZodType<unknown, unknown, import("better-auth").$ZodTypeInternals<unknown, unknown>>;
            }, import("better-auth").$strip>>>;
            readonly getOperators: <TApp>(config: import("questpie").ObjectFieldConfig) => {
                column: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    hasAnyKeys: import("questpie").OperatorFn<string[], unknown>;
                    pathEquals: import("questpie").OperatorFn<{
                        path: string[];
                        val: unknown;
                    }, unknown>;
                    jsonPath: import("questpie").OperatorFn<string, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<unknown, unknown>;
                    containedBy: import("questpie").OperatorFn<unknown, unknown>;
                    hasKey: import("questpie").OperatorFn<string, unknown>;
                    hasKeys: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").ObjectFieldConfig) => import("questpie").NestedFieldMetadata;
        };
        relation: {
            readonly type: "relation";
            readonly _value: string | string[] | {
                type: string;
                id: string;
            } | null;
            readonly toColumn: (name: string, config: import("questpie").RelationFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").RelationFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodObject<{
                type: import("better-auth").ZodEnum<{
                    [x: string]: string;
                }>;
                id: import("better-auth").ZodString;
            }, import("better-auth").$strip> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodObject<{
                type: import("better-auth").ZodEnum<{
                    [x: string]: string;
                }>;
                id: import("better-auth").ZodString;
            }, import("better-auth").$strip>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").RelationFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    contains: import("questpie").OperatorFn<string, unknown>;
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    contains: import("questpie").OperatorFn<string, unknown>;
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                };
                jsonb: {
                    some: import("questpie").OperatorFn<unknown, unknown>;
                    none: import("questpie").OperatorFn<unknown, unknown>;
                    every: import("questpie").OperatorFn<unknown, unknown>;
                    count: import("questpie").OperatorFn<number, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").RelationFieldConfig) => import("questpie").RelationFieldMetadata;
        };
        richText: {
            readonly type: "richText";
            readonly _value: import("node_modules/@questpie/admin/src/server").TipTapDocument;
            readonly toColumn: (_name: string, config: import("node_modules/@questpie/admin/src/server").RichTextFieldConfig) => any;
            readonly toZodSchema: (config: import("node_modules/@questpie/admin/src/server").RichTextFieldConfig) => any;
            readonly getOperators: <TApp>() => import("questpie").ContextualOperators<import("questpie").OperatorMap, import("questpie").OperatorMap>;
            readonly getMetadata: (config: import("node_modules/@questpie/admin/src/server").RichTextFieldConfig) => import("questpie").FieldMetadataBase & {
                maxCharacters?: number | undefined;
                minCharacters?: number | undefined;
                features: import("node_modules/@questpie/admin/src/server").RichTextFeature[];
                headingLevels: (1 | 2 | 3 | 4 | 5 | 6)[];
                placeholder?: string | undefined;
                allowImages?: boolean | undefined;
                imageCollection?: string | undefined;
            };
        };
        select: {
            readonly type: "select";
            readonly _value: string | string[];
            readonly toColumn: (name: string, config: import("questpie").SelectFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").SelectFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>> | import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodEnum<{
                [x: string]: string;
            }> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodEnum<{
                [x: string]: string;
            }>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").SelectFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    eq: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    containsAll: import("questpie").OperatorFn<string[], unknown>;
                    containsAny: import("questpie").OperatorFn<string[], unknown>;
                    eq: import("questpie").OperatorFn<string[], unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    length: import("questpie").OperatorFn<number, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").SelectFieldConfig) => import("questpie").SelectFieldMetadata;
        };
        text: {
            readonly type: "text";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TextFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TextFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").TextFieldConfig) => {
                column: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly notLike: import("questpie").OperatorFn<string, unknown>;
                    readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TextFieldConfig) => import("questpie").FieldMetadataBase;
        };
        textarea: {
            readonly type: "textarea";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TextareaFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TextareaFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").TextareaFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    isEmpty: import("questpie").OperatorFn<boolean, unknown>;
                    isNotEmpty: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TextareaFieldConfig) => import("questpie").FieldMetadataBase;
        };
        time: {
            readonly type: "time";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").TimeFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").TimeFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>() => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    before: import("questpie").OperatorFn<string, unknown>;
                    after: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    gt: import("questpie").OperatorFn<string, unknown>;
                    gte: import("questpie").OperatorFn<string, unknown>;
                    lt: import("questpie").OperatorFn<string, unknown>;
                    lte: import("questpie").OperatorFn<string, unknown>;
                    between: import("questpie").OperatorFn<[string, string], unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").TimeFieldConfig) => import("questpie").FieldMetadataBase & {
                min?: string | undefined;
                max?: string | undefined;
                withSeconds?: boolean | undefined;
                precision?: number | undefined;
            };
        };
        upload: {
            readonly type: "upload";
            readonly _value: string | string[];
            readonly toColumn: (name: string, config: import("questpie").UploadFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").UploadFieldConfig) => import("better-auth").ZodArray<import("better-auth").ZodString> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodArray<import("better-auth").ZodString>>> | import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").UploadFieldConfig) => {
                column: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly notLike: import("questpie").OperatorFn<string, unknown>;
                    readonly notIlike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
                jsonb: {
                    readonly eq: import("questpie").OperatorFn<string, unknown>;
                    readonly ne: import("questpie").OperatorFn<string, unknown>;
                    readonly in: import("questpie").OperatorFn<string[], unknown>;
                    readonly notIn: import("questpie").OperatorFn<string[], unknown>;
                    readonly like: import("questpie").OperatorFn<string, unknown>;
                    readonly ilike: import("questpie").OperatorFn<string, unknown>;
                    readonly contains: import("questpie").OperatorFn<string, unknown>;
                    readonly startsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly endsWith: import("questpie").OperatorFn<string, unknown>;
                    readonly isNull: import("questpie").OperatorFn<boolean, unknown>;
                    readonly isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                };
            } | {
                column: {
                    readonly some: import("questpie").OperatorFn<boolean, unknown>;
                    readonly none: import("questpie").OperatorFn<boolean, unknown>;
                    readonly every: import("questpie").OperatorFn<boolean, unknown>;
                    readonly count: import("questpie").OperatorFn<number, unknown>;
                };
                jsonb: {
                    readonly some: import("questpie").OperatorFn<boolean, unknown>;
                    readonly none: import("questpie").OperatorFn<boolean, unknown>;
                    readonly every: import("questpie").OperatorFn<boolean, unknown>;
                    readonly count: import("questpie").OperatorFn<number, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").UploadFieldConfig) => import("questpie").RelationFieldMetadata;
        };
        url: {
            readonly type: "url";
            readonly _value: string;
            readonly toColumn: (name: string, config: import("questpie").UrlFieldConfig) => any;
            readonly toZodSchema: (config: import("questpie").UrlFieldConfig) => import("better-auth").ZodOptional<import("better-auth").ZodNullable<import("better-auth").ZodString>> | import("better-auth").ZodString;
            readonly getOperators: <TApp>(config: import("questpie").UrlFieldConfig) => {
                column: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    notLike: import("questpie").OperatorFn<string, unknown>;
                    notIlike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    host: import("questpie").OperatorFn<string, unknown>;
                    hostIn: import("questpie").OperatorFn<string[], unknown>;
                    protocol: import("questpie").OperatorFn<string, unknown>;
                };
                jsonb: {
                    eq: import("questpie").OperatorFn<string, unknown>;
                    ne: import("questpie").OperatorFn<string, unknown>;
                    in: import("questpie").OperatorFn<string[], unknown>;
                    notIn: import("questpie").OperatorFn<string[], unknown>;
                    like: import("questpie").OperatorFn<string, unknown>;
                    ilike: import("questpie").OperatorFn<string, unknown>;
                    contains: import("questpie").OperatorFn<string, unknown>;
                    startsWith: import("questpie").OperatorFn<string, unknown>;
                    endsWith: import("questpie").OperatorFn<string, unknown>;
                    isNull: import("questpie").OperatorFn<boolean, unknown>;
                    isNotNull: import("questpie").OperatorFn<boolean, unknown>;
                    host: import("questpie").OperatorFn<string, unknown>;
                    protocol: import("questpie").OperatorFn<string, unknown>;
                };
            };
            readonly getMetadata: (config: import("questpie").UrlFieldConfig) => import("questpie").FieldMetadataBase;
        };
    }>;
    globals: import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, never>, import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, never>, {}>>;
    jobs: import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, "realtimeCleanup">, import("questpie").TypeMerge<import("questpie").UnsetProperty<{}, "realtimeCleanup">, {
        realtimeCleanup: import("questpie").JobDefinition<Record<string, never>, void, "questpie.realtime.cleanup", any>;
    }>>;
    locale: undefined;
    migrations: undefined;
    name: "questpie";
    translations: undefined;
    "~messageKeys": "access.denied" | "access.fieldDenied" | "access.operationDenied" | "auth.accountLocked" | "auth.emailNotVerified" | "auth.invalidCredentials" | "auth.sessionExpired" | "auth.tokenExpired" | "auth.tokenInvalid" | "auth.userAlreadyExists" | "auth.userNotFound" | "crud.create.forbidden" | "crud.delete.forbidden" | "crud.notFound" | "crud.read.forbidden" | "crud.update.forbidden" | "error.badRequest" | "error.conflict" | "error.database.checkViolation" | "error.database.foreignKeyViolation" | "error.database.notNullViolation" | "error.database.uniqueViolation" | "error.forbidden" | "error.internal" | "error.notFound" | "error.notFound.withId" | "error.notImplemented" | "error.timeout" | "error.unauthorized" | "error.validation" | "hook.afterCreate.failed" | "hook.afterDelete.failed" | "hook.afterUpdate.failed" | "hook.beforeCreate.failed" | "hook.beforeDelete.failed" | "hook.beforeUpdate.failed" | "hook.validate.failed" | "upload.failed" | "upload.invalidType" | "upload.tooLarge" | "validation.array.tooBig" | "validation.array.tooSmall" | "validation.date.invalid" | "validation.date.tooEarly" | "validation.date.tooLate" | "validation.invalidType" | "validation.number.notInteger" | "validation.number.notNegative" | "validation.number.notPositive" | "validation.number.tooBig" | "validation.number.tooSmall" | "validation.required" | "validation.string.email" | "validation.string.regex" | "validation.string.tooBig" | "validation.string.tooSmall" | "validation.string.url" | "validation.string.uuid";
}>;
