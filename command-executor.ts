import { ErrorCode, McpError } from "npm:@modelcontextprotocol/sdk/types.js";
import { readConfig } from "./config.ts";
import type { Config } from "./config.ts";

/**
 * コマンド実行の結果を表すインターフェース
 */
export interface CommandExecutionResult {
  output: string;
  error: string;
}

/**
 * コマンド実行のオプションを表すインターフェース
 */
export interface CommandExecutionOptions {
  commandName: string;
  args?: string[];
  allowedCommands?: Set<string>;
  readConfigFn?: () => Promise<Config>;
  executeCommandFn?: (command: string, args: string[], isWindows: boolean) => Promise<CommandExecutionResult>;
}

/**
 * コマンドが許可されているかどうかをチェックする
 */
export async function isCommandAllowed(
  command: string, 
  allowedCommands: Set<string>, 
  readConfigFn: () => Promise<Config>
): Promise<boolean> {
  // デフォルトの許可リストをチェック
  if (allowedCommands.has(command)) {
    return true;
  }

  // 設定ファイルからの追加コマンドをチェック
  try {
    const config = await readConfigFn();
    return Object.values(config.allowedCommands || {})
      .some((commands: string[]) => commands.includes(command));
  } catch (error) {
    console.error("追加コマンドの確認に失敗:", error);
    return false;
  }
}

/**
 * デフォルトのコマンド実行関数
 */
export async function defaultExecuteCommand(
  command: string, 
  args: string[], 
  isWindows: boolean
): Promise<CommandExecutionResult> {
  const process = new Deno.Command(
    isWindows ? "cmd.exe" : command,
    {
      args: isWindows ? ["/c", command, ...args] : args,
      stdout: "piped",
      stderr: "piped",
    }
  );
  
  const { stdout, stderr } = await process.output();
  const output = new TextDecoder().decode(stdout);
  const error = new TextDecoder().decode(stderr);
  
  return { output, error };
}

/**
 * コマンドを実行する関数
 */
export async function executeCommand(options: CommandExecutionOptions): Promise<CommandExecutionResult> {
  const { 
    commandName, 
    args = [], 
    allowedCommands = new Set<string>(),
    readConfigFn = readConfig,
    executeCommandFn = defaultExecuteCommand
  } = options;

  // コマンド文字列をパースする処理
  let actualCommand = commandName;
  let actualArgs = [...args];

  // スペースが含まれている場合はコマンドと引数に分割
  if (commandName.includes(' ')) {
    // 先頭と末尾の空白を削除してから分割
    const trimmedCommand = commandName.trim();
    const parts = trimmedCommand.split(/\s+/).filter(part => part.length > 0);
    actualCommand = parts[0];
    actualArgs = [...parts.slice(1), ...args];
    console.error(`コマンドをパースしました: ${commandName} => ${actualCommand} ${actualArgs.join(' ')}`);
  }

  // コマンドが許可されているかチェック
  const isAllowed = await isCommandAllowed(actualCommand, allowedCommands, readConfigFn);
  if (!isAllowed) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `コマンド '${commandName}' は許可されていません`
    );
  }

  try {
    // OSに応じてコマンドを実行
    const isWindows = Deno.build.os === "windows";
    return await executeCommandFn(actualCommand, actualArgs, isWindows);
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `コマンド実行エラー: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
