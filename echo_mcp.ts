#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write --allow-run

import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
} from "npm:@modelcontextprotocol/sdk/types.js";
import * as path from "@std/path"
import TurndownService from "npm:turndown";
import * as toml from "@std/toml";

type Config = {
	allowedDirectories: string[];
};

let configDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "~";
// backslash to forward slash for windows
configDir = configDir.replace(/\\/g, "/");
const configFile = path.join(configDir, ".mcp-cmdex.toml");


async function readConfig(): Promise<Config> {
	console.error("許可されたディレクトリ(loading):", configFile);
	const content = await Deno.readTextFile(configFile);
	const config = toml.parse(content) as Config;
	console.error("許可されたディレクトリ(loaded):", config.allowedDirectories);
	return config;
}

// パスの正規化と検証用のユーティリティ関数
async function validatePath(requestedPath: string): Promise<string> {
	let config: Config;
	try {
		config = await readConfig();
	} catch (error) {
		console.error("許可されたディレクトリの読み取りに失敗しました:", error);
		throw new Error("許可されたディレクトリの読み取りに失敗しました" + error);
	}
	const absolute = path.isAbsolute(requestedPath)
		? requestedPath
		: path.resolve(Deno.cwd(), requestedPath);

	const normalized = path.normalize(absolute);

	// 許可されたディレクトリ内かチェック
	const isAllowed = config.allowedDirectories.some((dir) =>
		normalized.startsWith(dir),
	);
	if (!isAllowed) {
		throw new Error(
			`アクセスが拒否されました - パスが許可されたディレクトリの外です: ${absolute}\n許可されたディレクトリ: ${config.allowedDirectories.join(', ')}`,
		);
	}

	try {
		const realPath = await Deno.realPath(absolute);
		const normalizedReal = path.normalize(realPath);
		const isRealPathAllowed = config.allowedDirectories.some((dir) =>
			normalizedReal.startsWith(dir),
		);
		if (!isRealPathAllowed) {
			throw new Error(
				`アクセスが拒否されました - シンボリックリンクの対象が許可されたディレクトリの外です: ${realPath}\n許可されたディレクトリ: ${config.allowedDirectories.join(', ')}`,
			);
		}
		return realPath;
	} catch (error) {
		// 新規ファイル作成の場合は親ディレクトリをチェック
		const parentDir = path.dirname(absolute);
		try {
			const realParentPath = await Deno.realPath(parentDir);
			const normalizedParent = path.normalize(realParentPath);
			const isParentAllowed = config.allowedDirectories.some((dir) =>
				normalizedParent.startsWith(dir),
			);
			if (!isParentAllowed) {
				throw new Error(
					`アクセスが拒否されました - 親ディレクトリが許可されたディレクトリの外です: ${parentDir}\n許可されたディレクトリ: ${config.allowedDirectories.join(', ')}`,
				);
			}
			return absolute;
		} catch {
			throw new Error(`親ディレクトリが存在しません: ${parentDir}`);
		}
	}
}

class EchoServer {
	private server: Server;

	constructor() {
		this.server = new Server(
			{
				name: "echo-server",
				version: "0.2.0",
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
				{
					name: "read_file",
					description: "ファイルの内容を読み取ります",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "読み取るファイルのパス",
							},
						},
						required: ["path"],
					},
				},
				{
					name: "write_file",
					description: "ファイルに内容を書き込みます",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "書き込み先のファイルパス",
							},
							content: {
								type: "string",
								description: "書き込む内容",
							},
						},
						required: ["path", "content"],
					},
				},
				{
					name: "list_directory",
					description: "ディレクトリの内容を一覧表示します",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "一覧表示するディレクトリのパス",
							},
						},
						required: ["path"],
					},
				},
				{
					name: "open_config_file",
					description: "設定ファイルを開きます",
					inputSchema: {
						type: "object",
						properties: {}, // no arguments
					},
				},
			],
		}));

		// ツールの実装
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			try {
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
									`取得に失敗しました: ${response.status} ${response.statusText}`,
								);
							}
							const html = await response.text();
							// HTMLをMarkdownに変換
							const markdown = new TurndownService().turndown(html);
							return {
								content: [
									{
										type: "text",
										text: markdown,
									},
								],
							};
						} catch (error) {
							if (error instanceof McpError) {
								throw error;
							}
							throw new McpError(
								ErrorCode.InternalError,
								`取得エラー: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}

					case "read_file": {
						const { path: filePath } = request.params.arguments as {
							path: string;
						};
						const validPath = await validatePath(filePath);
						const content = await Deno.readTextFile(validPath);
						// contextがJSONだとレスポンスが壊れるので
						return {
							content: [
								{
									type: "text",
									text: content,
								},
							],
						};
					}

					case "write_file": {
						const { path: filePath, content } = request.params.arguments as {
							path: string;
							content: string;
						};
						const validPath = await validatePath(filePath);
						await Deno.writeTextFile(validPath, content);
						return {
							content: [
								{
									type: "text",
									text: `ファイルの書き込みに成功しました: ${filePath}`,
								},
							],
						};
					}

					case "list_directory": {
						const { path: dirPath } = request.params.arguments as {
							path: string;
						};
						const validPath = await validatePath(dirPath);
						const entries = [];
						for await (const entry of Deno.readDir(validPath)) {
							entries.push(
								`[${entry.isDirectory ? "DIR" : "FILE"}] ${entry.name}`,
							);
						}
						return {
							content: [
								{
									type: "text",
									text: entries.join("\n"),
								},
							],
						};
					}

					case "open_config_file": {
						// windows
						if (Deno.build.os === "windows") {
							const command = new Deno.Command("notepad", {args: [configFile]});
							command.spawn();
						} else {
							const command = new Deno.Command("open", {args: [configFile]});
							command.spawn();
						}
						return {
							content: [
								{
									type: "text",
									text: "設定ファイルを開きます",
								},
							],
						};
					}

					default:
						throw new McpError(
							ErrorCode.MethodNotFound,
							`不明なツール: ${request.params.name}`,
						);
				}
			} catch (error) {
				if (error instanceof McpError) {
					throw error;
				}
				throw new McpError(
					ErrorCode.InternalError,
					`エラー: ${error instanceof Error ? error.message : String(error)}`,
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
