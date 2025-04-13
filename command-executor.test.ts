import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { McpError } from "npm:@modelcontextprotocol/sdk/types.js";
import { executeCommand, isCommandAllowed } from "./command-executor.ts";
import type { CommandExecutionResult } from "./command-executor.ts";
import type { Config } from "./config.ts";

// テスト用のモックヘルパー関数
function createMockFunction<T, R>(returnValue: R): () => Promise<R> {
  return () => Promise.resolve(returnValue);
}

// isCommandAllowed のテスト
Deno.test("isCommandAllowed - コマンドが許可リストにある場合はtrueを返す", async () => {
  const allowedCommands = new Set(["ls", "cat", "echo"]);
  const mockReadConfig = createMockFunction<void, Config>({
    allowedCommands: {},
    allowedDirectories: []
  });
  
  const result = await isCommandAllowed("ls", allowedCommands, mockReadConfig);
  assertEquals(result, true);
});

Deno.test("isCommandAllowed - コマンドが設定ファイルの許可リストにある場合はtrueを返す", async () => {
  const allowedCommands = new Set(["ls", "cat"]);
  const mockReadConfig = createMockFunction<void, Config>({
    allowedCommands: {
      "custom": ["echo", "grep"]
    },
    allowedDirectories: []
  });
  
  const result = await isCommandAllowed("grep", allowedCommands, mockReadConfig);
  assertEquals(result, true);
});

Deno.test("isCommandAllowed - コマンドが許可されていない場合はfalseを返す", async () => {
  const allowedCommands = new Set(["ls", "cat"]);
  const mockReadConfig = createMockFunction<void, Config>({
    allowedCommands: {
      "custom": ["echo", "grep"]
    },
    allowedDirectories: []
  });
  
  const result = await isCommandAllowed("rm", allowedCommands, mockReadConfig);
  assertEquals(result, false);
});

Deno.test("isCommandAllowed - 設定ファイルの読み込みに失敗した場合でも許可リストにあるコマンドはtrueを返す", async () => {
  const allowedCommands = new Set(["ls", "cat"]);
  const mockReadConfig = () => Promise.reject(new Error("Config error"));
  
  const result = await isCommandAllowed("ls", allowedCommands, mockReadConfig);
  assertEquals(result, true);
});

Deno.test("isCommandAllowed - 設定ファイルの読み込みに失敗し許可リストにないコマンドはfalseを返す", async () => {
  const allowedCommands = new Set(["ls", "cat"]);
  const mockReadConfig = () => Promise.reject(new Error("Config error"));
  
  const result = await isCommandAllowed("grep", allowedCommands, mockReadConfig);
  assertEquals(result, false);
});

// executeCommand のテスト
Deno.test("executeCommand - コマンドを実行して結果を返す", async () => {
  let executeCalled = false;
  const mockExecuteCommandFn = (_command: string, _args: string[], _isWindows: boolean): Promise<CommandExecutionResult> => {
    executeCalled = true;
    return Promise.resolve({ output: "command output", error: "" });
  };
  
  const mockReadConfigFn = createMockFunction<void, Config>({
    allowedCommands: {},
    allowedDirectories: []
  });
  
  const result = await executeCommand({
    commandName: "echo",
    args: ["hello"],
    allowedCommands: new Set(["echo"]),
    readConfigFn: mockReadConfigFn,
    executeCommandFn: mockExecuteCommandFn
  });
  
  assertEquals(result.output, "command output");
  assertEquals(result.error, "");
  assertEquals(executeCalled, true);
});

// 複雑なコマンドのテストケースを定義するインターフェース
interface CommandTestCase {
  name: string;
  commandName: string;
  args: string[];
  expectedCommand: string;
  expectedArgs: string[];
}

// テストテーブルを使った複雑なコマンドのテスト
Deno.test("executeCommand - 複雑なオプション付きコマンドを正しくパースする", async () => {
  // テストケースのテーブル
  const testCases: CommandTestCase[] = [
    {
      name: "スペースを含むシンプルなコマンド",
      commandName: "echo hello",
      args: ["world"],
      expectedCommand: "echo",
      expectedArgs: ["hello", "world"]
    },
    {
      name: "複数の引数を持つコマンド",
      commandName: "find . -name",
      args: ["*.ts", "-type", "f"],
      expectedCommand: "find",
      expectedArgs: [".", "-name", "*.ts", "-type", "f"]
    },
    {
      name: "引用符を含むコマンド",
      commandName: "grep 'test pattern'",
      args: ["file.txt"],
      expectedCommand: "grep",
      expectedArgs: ["'test", "pattern'", "file.txt"]
    },
    {
      name: "複数のスペースとタブを含むコマンド",
      commandName: "ls  -la   ",
      args: ["/tmp"],
      expectedCommand: "ls",
      expectedArgs: ["-la", "/tmp"]
    },
    {
      name: "オプションフラグを含むコマンド",
      commandName: "curl -X POST",
      args: ["-H", "Content-Type: application/json", "https://example.com"],
      expectedCommand: "curl",
      expectedArgs: ["-X", "POST", "-H", "Content-Type: application/json", "https://example.com"]
    },
    {
      name: "パイプとリダイレクトを含むコマンド（実際のシェルでは動作しないがパースのテスト）",
      commandName: "cat file.txt | grep pattern",
      args: [],
      expectedCommand: "cat",
      expectedArgs: ["file.txt", "|", "grep", "pattern"]
    },
    {
      name: "先頭と末尾に空白を含むコマンド",
      commandName: "  git status  ",
      args: [],
      expectedCommand: "git",
      expectedArgs: ["status"]
    }
  ];

  // 各テストケースを実行
  for (const testCase of testCases) {
    let actualCommand = "";
    let actualArgs: string[] = [];
    
    const mockExecuteCommandFn = (command: string, args: string[], _isWindows: boolean): Promise<CommandExecutionResult> => {
      actualCommand = command;
      actualArgs = args;
      return Promise.resolve({ output: "test output", error: "" });
    };
    
    const mockReadConfigFn = createMockFunction<void, Config>({
      allowedCommands: {},
      allowedDirectories: []
    });
    
    // テストケース名を表示
    console.log(`テストケース: ${testCase.name}`);
    
    await executeCommand({
      commandName: testCase.commandName,
      args: testCase.args,
      allowedCommands: new Set([testCase.expectedCommand]),
      readConfigFn: mockReadConfigFn,
      executeCommandFn: mockExecuteCommandFn
    });
    
    // 検証
    assertEquals(actualCommand, testCase.expectedCommand, `コマンド名が期待値と一致しません: ${testCase.name}`);
    assertEquals(actualArgs, testCase.expectedArgs, `コマンド引数が期待値と一致しません: ${testCase.name}`);
  }
});

Deno.test("executeCommand - スペースを含むコマンドを正しくパースする", async () => {
  let actualCommand = "";
  let actualArgs: string[] = [];
  
  const mockExecuteCommandFn = (command: string, args: string[], _isWindows: boolean): Promise<CommandExecutionResult> => {
    actualCommand = command;
    actualArgs = args;
    return Promise.resolve({ output: "hello world", error: "" });
  };
  
  const mockReadConfigFn = createMockFunction<void, Config>({
    allowedCommands: {},
    allowedDirectories: []
  });
  
  const result = await executeCommand({
    commandName: "echo hello",
    args: ["world"],
    allowedCommands: new Set(["echo"]),
    readConfigFn: mockReadConfigFn,
    executeCommandFn: mockExecuteCommandFn
  });
  
  assertEquals(actualCommand, "echo");
  assertEquals(actualArgs, ["hello", "world"]);
  assertEquals(result.output, "hello world");
});

Deno.test("executeCommand - 許可されていないコマンドはエラーを投げる", async () => {
  let executeCalled = false;
  const mockExecuteCommandFn = (_command: string, _args: string[], _isWindows: boolean): Promise<CommandExecutionResult> => {
    executeCalled = true;
    return Promise.resolve({ output: "", error: "" });
  };
  
  const mockReadConfigFn = createMockFunction<void, Config>({
    allowedCommands: {},
    allowedDirectories: []
  });
  
  try {
    await executeCommand({
      commandName: "dangerous-command",
      args: ["test"],
      allowedCommands: new Set(["echo"]),
      readConfigFn: mockReadConfigFn,
      executeCommandFn: mockExecuteCommandFn
    });
    // エラーが発生しなかった場合はテスト失敗
    assertEquals(true, false, "許可されていないコマンドが実行されました");
  } catch (error) {
    if (error instanceof McpError) {
      assertEquals(error.message.includes("許可されていません"), true);
      assertEquals(executeCalled, false);
    } else {
      // 予期しないエラータイプの場合はテスト失敗
      assertEquals(true, false, `予期しないエラータイプ: ${String(error)}`);
    }
  }
});

Deno.test("executeCommand - コマンド実行エラーを適切に処理する", async () => {
  const mockExecuteCommandFn = (_command: string, _args: string[], _isWindows: boolean): Promise<CommandExecutionResult> => {
    return Promise.reject(new Error("Command failed"));
  };
  
  const mockReadConfigFn = createMockFunction<void, Config>({
    allowedCommands: {},
    allowedDirectories: []
  });
  
  try {
    await executeCommand({
      commandName: "echo",
      args: ["hello"],
      allowedCommands: new Set(["echo"]),
      readConfigFn: mockReadConfigFn,
      executeCommandFn: mockExecuteCommandFn
    });
    // エラーが発生しなかった場合はテスト失敗
    assertEquals(true, false, "コマンド実行エラーが処理されませんでした");
  } catch (error) {
    if (error instanceof McpError) {
      assertEquals(error.message.includes("コマンド実行エラー"), true);
    } else {
      // 予期しないエラータイプの場合はテスト失敗
      assertEquals(true, false, `予期しないエラータイプ: ${String(error)}`);
    }
  }
});
