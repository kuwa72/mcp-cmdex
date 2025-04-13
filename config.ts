import * as path from "@std/path";
import * as toml from "@std/toml";

/**
 * 設定ファイルの型定義
 */
export type Config = {
  allowedDirectories: string[];
  allowedCommands?: {
    [category: string]: string[];
  };
  llm?: {
    enabled: boolean;
  };
};

/**
 * 設定ファイルのパスを取得する
 */
export function getConfigFilePath(): string {
  let configDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "~";
  // backslash to forward slash for windows
  configDir = configDir.replace(/\\/g, "/");
  return path.join(configDir, ".mcp-cmdex.toml");
}

/**
 * 設定ファイルを読み込む
 */
export async function readConfig(): Promise<Config> {
  const configFile = getConfigFilePath();
  console.error("設定ファイル(loading):", configFile);
  try {
    const content = await Deno.readTextFile(configFile);
    const config = toml.parse(content) as Config;
    console.error("許可されたディレクトリ(loaded):", config.allowedDirectories);
    return config;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // 設定ファイルが存在しない場合はデフォルト設定を返す
      return { allowedDirectories: [] };
    }
    throw error;
  }
}
