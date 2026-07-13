export type AuthHeaders = Record<string, string>;

export type GetAuthHeaders = () => AuthHeaders | Promise<AuthHeaders>;
