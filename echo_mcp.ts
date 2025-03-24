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
				{
					name: "execute_command",
					description: "許可されたシェルコマンドを実行します",
					inputSchema: {
						type: "object",
						properties: {
							command: {
								type: "string",
								description: "実行するコマンド（引数を含む）",
							},
						},
						required: ["command"],
					},
				},
				{
					name: "list_allowed_commands",
					description: "実行可能なコマンドの一覧を返します",
					inputSchema: {
						type: "object",
						properties: {}, // no arguments
					},
				},
			],
		}));

		// ツールの実装
		const ALLOWED_COMMANDS = new Set([
			// Windows/DOSコマンド
			'dir', 'copy', 'xcopy', 'robocopy', 'move', 'del', 'rd', 'md', 'type', 'more',
			'find', 'findstr', 'sort', 'fc', 'comp', 'tree', 'where', 'whoami', 'tasklist',
			'taskkill', 'systeminfo', 'hostname', 'ipconfig', 'netstat', 'net', 'ping',
			'tracert', 'nslookup', 'pathping', 'route', 'arp', 'attrib', 'chcp', 'cipher',
			'clip', 'compact', 'expand', 'forfiles', 'fsutil', 'ftype', 'reg', 'sc',
			'schtasks', 'shutdown', 'timeout', 'title', 'ver', 'vol', 'wmic', 'powershell',
			'pwsh', 'cmd', // シェル関連
			// shell
			'bash', 'sh', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'dash', 'ash',
			// GNU Core Utils & BusyBox基本コマンド
			'ls', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'cat', 'head', 'tail', 'grep', 'find',
			'sort', 'uniq', 'wc', 'tr', 'cut', 'paste', 'join', 'split', 'basename',
			'dirname', 'pwd', 'date', 'touch', 'chmod', 'chown', 'df', 'du', 'ln', 'tar',
			'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zip', 'unzip',
			// テキスト処理ツール
			'awk', 'gawk', 'mawk', 'nawk',
			'sed', 'gsed', 'ssed', // sedとその実装
			'jq', 'yq', 'fx', // JSONプロセッサ
			'csvkit', 'xsv', 'tsv-utils', // CSV/TSV処理
			'pandoc', 'asciidoctor', // ドキュメント変換
			// データベースクライアント
			'sqlite3', 'sqlite', // SQLite
			'mysql', 'mysqldump', 'mysqlimport', // MySQL
			'psql', 'pg_dump', 'pg_restore', // PostgreSQL
			'mongosh', 'mongoexport', 'mongoimport', // MongoDB
			'redis-cli', // Redis
			'duckdb', // DuckDB
			'influx', // InfluxDB
			// 開発ツール - コンパイラ/インタプリタ
			'gcc', 'g++', 'clang', 'clang++', 'rustc', 'python', 'python3', 'node', 'deno',
			'java', 'javac', 'kotlin', 'kotlinc', 'go', 'gofmt', 'ruby', 'perl', 'php',
			'ghc', 'stack', 'cabal', // Haskell
			'scala', 'scalac', // Scala
			'dotnet', // .NET
			'tsc', 'esbuild', 'swc', // TypeScript/JavaScript
			// パッケージマネージャ
			'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'gem', 'composer', 'maven',
			'gradle', 'sbt', 'nuget', 'vcpkg', 'conan', // 追加のパッケージマネージャ
			// ビルド/タスクツール
			'make', 'cmake', 'ninja', 'rake', 'grunt', 'gulp', 'webpack', 'rollup', 'vite',
			'bazel', 'buck', // ビルドシステム
			// テストツール
			'jest', 'pytest', 'rspec', 'mocha', 'karma', 'cypress', 'playwright',
			// 開発支援ツール
			'git', 'gh', // バージョン管理
			'curl', 'wget', 'httpie', // HTTP クライアント
			'docker', 'podman', // コンテナ
			'terraform', 'ansible', // インフラ
			'protoc', 'grpcurl', // プロトコル
			'shellcheck', 'shfmt', // シェルスクリプト
			'prettier', 'eslint', 'stylelint', // フォーマッタ/リンタ
			'graphql', 'hasura', // GraphQL
		]);

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

					case "execute_command": {
						const { command } = request.params.arguments as { command: string };
						const commandName = command.split(" ")[0];

						if (!ALLOWED_COMMANDS.has(commandName)) {
							throw new McpError(
								ErrorCode.InvalidRequest,
								`コマンド '${commandName}' は許可されていません`
							);
						}

						try {
							const process = new Deno.Command(commandName, {
								args: command.split(" ").slice(1),
								stdout: "piped",
								stderr: "piped",
							});
							const { stdout, stderr } = await process.output();
							const output = new TextDecoder().decode(stdout);
							const error = new TextDecoder().decode(stderr);

							return {
								content: [
									{
										type: "text",
										text: `実行結果:\n${output}\nエラー:\n${error}`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`コマンド実行エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "list_allowed_commands": {
						// カテゴリごとにコマンドを整理
						const commandsByCategory = new Map<string, string[]>();
						let currentCategory = "";
						
						// ALLOWED_COMMANDSの定義順を保持するため、配列に変換
						const commandsArray = Array.from(ALLOWED_COMMANDS);
						
						// コマンドをカテゴリごとに分類
						commandsArray.forEach(cmd => {
							if (cmd.startsWith("//")) {
								// カテゴリコメントを検出
								currentCategory = cmd.substring(2).trim();
								commandsByCategory.set(currentCategory, []);
							} else {
								const category = commandsByCategory.get(currentCategory) || [];
								category.push(cmd);
								commandsByCategory.set(currentCategory, category);
							}
						});

						// 整形された出力を生成
						const output = Array.from(commandsByCategory.entries())
							.map(([category, commands]) => {
								return `${category}:\n  ${commands.join(", ")}`;
							})
							.join("\n\n");

						return {
							content: [
								{
									type: "text",
									text: output,
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
