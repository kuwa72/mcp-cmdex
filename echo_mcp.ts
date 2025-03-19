#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
} from "npm:@modelcontextprotocol/sdk/types.js";

class EchoServer {
	private server: Server;

	constructor() {
		this.server = new Server(
			{
				name: "echo-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.setupToolHandlers();

		this.server.onerror = (error) => console.error("[MCP Error]", error);
	}

	private setupToolHandlers() {
		// ツール一覧を提供
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: "echo",
					description: "入力された文字列をそのまま返します",
					inputSchema: {
						type: "object",
						properties: {
							text: {
								type: "string",
								description: "エコーする文字列",
							},
						},
						required: ["text"],
					},
				},
				{
					name: "fetch",
					description: "指定されたURLからコンテンツを取得します",
					inputSchema: {
						type: "object",
						properties: {
							url: {
								type: "string",
								description: "取得するコンテンツのURL",
							},
						},
						required: ["url"],
					},
				},
			],
		}));

		// ツールの実装
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			switch (request.params.name) {
				case "echo": {
					const { text } = request.params.arguments as { text: string };
					return {
						content: [
							{
								type: "text",
								text: text,
							},
						],
					};
				}

				case "fetch": {
					const { url } = request.params.arguments as { url: string };
					try {
						const response = await fetch(url);
						if (!response.ok) {
							throw new McpError(
								ErrorCode.InternalError,
								`Failed to fetch: ${response.status} ${response.statusText}`,
							);
						}
						const text = await response.text();
						return {
							content: [
								{
									type: "text",
									text: text,
								},
							],
						};
					} catch (error) {
						if (error instanceof McpError) {
							throw error;
						}
						throw new McpError(
							ErrorCode.InternalError,
							`Fetch error: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				default:
					throw new McpError(
						ErrorCode.MethodNotFound,
						`Unknown tool: ${request.params.name}`,
					);
			}
		});
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error("Echo MCP server running on stdio");
	}
}

// サーバーの起動
const server = new EchoServer();
server.run().catch(console.error);
