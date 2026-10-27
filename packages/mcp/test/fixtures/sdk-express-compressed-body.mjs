import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { deflateSync } from "node:zlib";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

const app = createMcpExpressApp({ host: "127.0.0.1" });
const first = Buffer.concat([
	deflateSync(Buffer.from('{"a":1}')),
	Buffer.from([0]),
]);
const trailing = Buffer.alloc(1024);
let client;
app.post("/compressed", (req, res, next) => {
	req.once("error", next);
	req.once("end", () => res.json(req.body));
	client.end(trailing);
});
app.get("/health", (_req, res) => res.json({ ok: true }));
const server = createServer(app);

try {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	const response = await new Promise((resolve, reject) => {
		client = request(
			{
				host: "127.0.0.1",
				port,
				method: "POST",
				path: "/compressed",
				agent: false,
				headers: {
					"Content-Type": "application/json",
					"Content-Encoding": "deflate",
					"Content-Length": first.length + trailing.length,
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode, body }));
				res.on("error", reject);
			},
		);
		client.on("error", reject);
		client.setTimeout(3000, () =>
			client.destroy(new Error("Request timed out")),
		);
		client.write(first);
	});
	assert.deepEqual(response, { status: 200, body: '{"a":1}' });
	const health = await fetch(`http://127.0.0.1:${port}/health`);
	assert.equal(health.status, 200);
	assert.deepEqual(await health.json(), { ok: true });
	console.log("compressed body and subsequent request passed");
} finally {
	client?.destroy();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
