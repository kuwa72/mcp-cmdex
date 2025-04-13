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
import { createLLMProcessor } from "./llm/processor-factory.ts";
import { fileOperationsAPIDefinitions } from "./file-operations.ts";
import { readConfig, getConfigFilePath } from "./config.ts";
import type { Config } from "./config.ts";
import { executeCommand } from "./command-executor.ts";

// Config型とreadConfig関数はconfig.tsに移動しました

// パスの正規化と検証用のユーティリティ関数
async function validatePath(requestedPath: string): Promise<string> {
	let config: Config;
	try {
		config = await readConfig();
	} catch (error) {
		console.error("許可されたディレクトリの読み取りに失敗しました:", error);
		throw new Error(`許可されたディレクトリの読み取りに失敗しました: ${error}`);
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
	} catch (_error) {
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

class MCPCommandServer {
	private server: Server;

	constructor() {
		this.server = new Server(
			{
				name: "mcp-cmdex",
				version: "0.2.0",
			},
			{
				capabilities: {
					tools: {
						...Object.fromEntries(fileOperationsAPIDefinitions.map((def) => [def.name, def])),
					},
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
					name: "get_path",
					description: "システムのPATH環境変数を表示します",
					inputSchema: {
						type: "object",
						properties: {},
						required: [],
					},
				},
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
							range: {
								type: "string",
								description: "読み取るファイルの範囲(n:m/:m/n:)",
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
					name: "append_file",
					description: "ファイルに内容を追加します",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "追加先のファイルパス",
							},
							content: {
								type: "string",
								description: "追加する内容",
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
					name: "create_directory",
					description: "新しいディレクトリを作成します",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "作成するディレクトリのパス",
							},
							recursive: {
								type: "boolean",
								description: "親ディレクトリも必要に応じて作成するかどうか",
								default: false
							}
						},
						required: ["path"],
					},
				},
				{
					name: "remove_directory",
					description: "ディレクトリを削除します",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "削除するディレクトリのパス",
							},
							recursive: {
								type: "boolean",
								description: "ディレクトリが空でない場合も再帰的に削除するかどうか",
								default: false
							}
						},
						required: ["path"],
					},
				},
				{
					name: "rename_directory",
					description: "ディレクトリの名前を変更または移動します",
					inputSchema: {
						type: "object",
						properties: {
							sourcePath: {
								type: "string",
								description: "名前変更または移動元のディレクトリパス",
							},
							destinationPath: {
								type: "string",
								description: "名前変更または移動先のディレクトリパス",
							}
						},
						required: ["sourcePath", "destinationPath"],
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
							commandName: {
								type: "string",
								description: "実行するコマンド名",
							},
							args: {
								type: "array",
								items: {
									type: "string"
								},
								description: "コマンドの引数",
								default: []
							}
						},
						required: ["commandName"],
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
					case "get_path": {
						const path = Deno.env.get("PATH");
						return {
							content: [
								{
									type: "text",
									text: path || "PATH環境変数が設定されていません",
								},
							],
						};
					}

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

							// LLM処理の設定を読み込む
							const config = await readConfig();
							if (config.llm?.enabled) {
								const processor = createLLMProcessor({
									enabled: true,
								});

								const result = await processor.process(markdown, config.llm);
								return {
									content: [
										{
											type: "text",
											text: result.processed,
										},
									],
								};
							}

							// LLMが無効な場合は元のMarkdownを返す
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
						const { path: filePath, range: rangeStr } = request.params.arguments as {
							path: string;
							range: string;
						};
						const validPath = await validatePath(filePath);
						const content = await Deno.readTextFile(validPath);
						const lines = content.split("\n");
						const range = rangeStr || "0:0";
						const [start, end] = range.split(":").map(Number);
						let selectedLines = "";
						if (!end) {
							selectedLines = lines.slice(start).join("\n");
						} else {
							selectedLines = lines.slice(start, end + 1).join("\n");
						}

						return {
							content: [
								{
									type: "text",
									text: selectedLines,
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

					case "append_file": {
						const { path: filePath, content } = request.params.arguments as {
							path: string;
							content: string;
						};
						const validPath = await validatePath(filePath);
						await Deno.writeTextFile(validPath, content, { append: true });
						return {
							content: [
								{
									type: "text",
									text: `ファイルの追加に成功しました: ${filePath}`,
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

					case "create_directory": {
						const { path: dirPath, recursive = false } = request.params.arguments as {
							path: string;
							recursive?: boolean;
						};
						const validPath = await validatePath(dirPath);
						try {
							await Deno.mkdir(validPath, { recursive });
							return {
								content: [
									{
										type: "text",
										text: `ディレクトリ '${dirPath}' を作成しました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ディレクトリ作成エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "remove_directory": {
						const { path: dirPath, recursive = false } = request.params.arguments as {
							path: string;
							recursive?: boolean;
						};
						const validPath = await validatePath(dirPath);
						try {
							await Deno.remove(validPath, { recursive });
							return {
								content: [
									{
										type: "text",
										text: `ディレクトリ '${dirPath}' を削除しました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ディレクトリ削除エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "rename_directory": {
						const { sourcePath, destinationPath } = request.params.arguments as {
							sourcePath: string;
							destinationPath: string;
						};
						const validSourcePath = await validatePath(sourcePath);
						const validDestPath = await validatePath(destinationPath);
						try {
							await Deno.rename(validSourcePath, validDestPath);
							return {
								content: [
									{
										type: "text",
										text: `ディレクトリを '${sourcePath}' から '${destinationPath}' に移動/名前変更しました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ディレクトリ名前変更/移動エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "open_config_file": {
						// windows
						if (Deno.build.os === "windows") {
							const command = new Deno.Command("notepad", {args: [getConfigFilePath()]});
							command.spawn();
						} else {
							const command = new Deno.Command("open", {args: [getConfigFilePath()]});
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
						const { commandName, args = [] } = request.params.arguments as { 
							commandName: string;
							args?: string[];
						};

						try {
							// リファクタリングされた executeCommand 関数を使用
							const result = await executeCommand({
								commandName,
								args,
								allowedCommands: ALLOWED_COMMANDS
							});

							return {
								content: [
									{
										type: "text",
										text: `実行結果:\n${result.output}\nエラー:\n${result.error}`,
									},
								],
							};
						} catch (error) {
							if (error instanceof McpError) {
								throw error;
							}
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
						
						// デフォルトのコマンドを追加
						const commandsArray = Array.from(ALLOWED_COMMANDS);
						for (const cmd of commandsArray) {
							if (cmd.startsWith("//")) {
								currentCategory = cmd.substring(2).trim();
								commandsByCategory.set(currentCategory, []);
							} else {
								const category = commandsByCategory.get(currentCategory) || [];
								category.push(cmd);
								commandsByCategory.set(currentCategory, category);
							}
						}

						// 設定ファイルからの追加コマンドを読み込む
						try {
							const config = await readConfig();
							if (config.allowedCommands) {
								for (const [category, commands] of Object.entries(config.allowedCommands)) {
									const existingCommands = commandsByCategory.get(category) || [];
									commandsByCategory.set(category, [...new Set([...existingCommands, ...commands])]);
								}
							}
						} catch (error) {
							console.error("追加コマンドの読み込みに失敗:", error);
						}

						// 整形された出力を生成
						const output = Array.from(commandsByCategory.entries())
							.map(([category, commands]) => {
								const sortedCommands = Array.from(new Set(commands)).sort();
								return `${category}:\n  ${sortedCommands.join(", ")}`;
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

					case "copy_file": {
						const { sourcePath, destinationPath } = request.params.arguments as {
							sourcePath: string;
							destinationPath: string;
						};
						const validSourcePath = await validatePath(sourcePath);
						const validDestPath = await validatePath(destinationPath);
						try {
							const content = await Deno.readFile(validSourcePath);
							await Deno.writeFile(validDestPath, content);
							return {
								content: [
									{
										type: "text",
										text: `ファイルを '${sourcePath}' から '${destinationPath}' にコピーしました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ファイルコピーエラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "move_file": {
						const { sourcePath, destinationPath } = request.params.arguments as {
							sourcePath: string;
							destinationPath: string;
						};
						const validSourcePath = await validatePath(sourcePath);
						const validDestPath = await validatePath(destinationPath);
						try {
							await Deno.rename(validSourcePath, validDestPath);
							return {
								content: [
									{
										type: "text",
										text: `ファイルを '${sourcePath}' から '${destinationPath}' に移動/名前変更しました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ファイル移動/名前変更エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "delete_file": {
						const { path: filePath } = request.params.arguments as {
							path: string;
						};
						const validPath = await validatePath(filePath);
						try {
							await Deno.remove(validPath);
							return {
								content: [
									{
										type: "text",
										text: `ファイル '${filePath}' を削除しました`,
									},
								],
							};
						} catch (error) {
							throw new McpError(
								ErrorCode.InternalError,
								`ファイル削除エラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}

					case "file_exists": {
						const { path: filePath } = request.params.arguments as {
							path: string;
						};
						const validPath = await validatePath(filePath);
						try {
							const stat = await Deno.stat(validPath);
							return {
								content: [
									{
										type: "text",
										text: `ファイル '${filePath}' は${stat.isFile ? "存在します" : "ファイルではありません"}`,
									},
								],
							};
						} catch (error) {
							if (error instanceof Deno.errors.NotFound) {
								return {
									content: [
										{
											type: "text",
											text: `ファイル '${filePath}' は存在しません`,
										},
									],
								};
							}
							throw new McpError(
								ErrorCode.InternalError,
								`ファイル存在チェックエラー: ${error instanceof Error ? error.message : String(error)}`
							);
						}
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
const server = new MCPCommandServer();
server.run().catch(console.error);
