import { createApp } from "#questpie/app";
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});
const northwind = client.withContext({ companyId: "company-northwind" });
const contoso = client.withContext({ companyId: "company-contoso" });

void northwind.queries["messages.page"]({
	channelId: "channel-private",
	first: 20,
	after: null,
});
void contoso.context.companyId;

// @ts-expect-error Context input is exact.
client.withContext({ companyId: "company-northwind", role: "owner" });
// @ts-expect-error Scoped Context is immutable.
northwind.context.companyId = "company-contoso";
// @ts-expect-error Output Policy makes moderationNote optional.
const requiredNote: string | null = (await northwind.queries["messages.get"]({
	id: "m1",
}))!.moderationNote;
void requiredNote;

async function directProof() {
	const app = await createApp({ postgres: { url: "postgres://local" } });
	const result = await app.execution(
		{
			principal: { kind: "user", id: "principal-alice" },
			context: { companyId: "company-northwind" },
		},
		async (execution) => {
			void execution.authority.kind;
			void execution.values.selectedRole;
			return execution.queries["messages.get"]({ id: "m1" });
		},
	);
	void result;

	await app.execution(
		{
			principal: { kind: "user", id: "principal-alice" },
			context: { companyId: "company-northwind" },
			// @ts-expect-error Ordinary direct roots cannot construct System Authority.
			authority: { kind: "system" },
		},
		async () => undefined,
	);
	await app.close();
}

void directProof;
