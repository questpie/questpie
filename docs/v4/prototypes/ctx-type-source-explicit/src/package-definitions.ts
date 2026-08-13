import type { AppForDefinitions } from "./framework";
import { bindDefinitions, operation } from "./framework";

type AuditRow = { readonly id: string; readonly subjectId: string };

/**
 * A published Package checks against its own narrow generated contract. A host
 * compiler may provide a wider concrete app context only after proving these
 * exact required members.
 */
interface AuditPackageContract extends AppForDefinitions {
	readonly definitions: {
		readonly query: {
			readonly principal: { readonly id: string };
			readonly data: {
				readonly auditEntries: {
					get(args: {
						readonly key: { readonly id: string };
						readonly select: {
							readonly id: true;
							readonly subjectId: true;
						};
					}): Promise<AuditRow | null>;
				};
			};
		};
		readonly mutation: object;
		readonly reaction: object;
		readonly job: object;
		readonly action: object;
		readonly route: object;
	};
}

const define = bindDefinitions<AuditPackageContract>();

export const auditEntry = define.query({
	name: "audit.entry",
	input: { id: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.auditEntries.get({
			key: { id: input.id },
			select: { id: true, subjectId: true },
		}),
});
