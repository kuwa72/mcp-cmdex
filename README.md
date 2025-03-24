# MCP-CMDEX

Model Context Protocol (MCP)のコマンド実行サーバーの実装です。Denoで実装されており、ファイルシステム操作やコマンド実行などの機能を提供します。

## 機能

* ファイルシステム操作
  * ファイルの読み書き
  * ディレクトリ一覧表示
* URLからのコンテンツ取得
* コマンド実行
* エコー機能
* 設定ファイル管理

## インストール

配布されている`mcp-cmdex`バイナリを実行ファイルとして使用してください。

自力でコンパイルする場合は以下のコマンドを実行してください。

```bash
deno task build
```

## 使用方法

実行ファイルを指定する

```
		"misc": {
			"command": "/path/to/mcp-cmdex",
			"disabled": false,
			"alwaysAllow": []
		}
```

filesystemがアクセス可能なディレクトリは設定ファイルで指定します。
Mac, Windowsで設定ファイルは以下の場所にあります。

* Mac: `~/.mcp-cmdex.toml`
* Windows: `%USERPROFILE%/.mcp-cmdex.toml`

```toml
# ディレクトリアクセス許可
allowedDirectories = ["/path/to/directory", "/path/to/another/directory"]

# コマンド実行許可（オプション）
[allowedCommands]
system = ["ls", "cat", "echo"]
network = ["curl", "wget"]
```

### 試すには

```bash
# ツール一覧を取得
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | mcp-cmdex

# エコー機能を実行
echo '{"jsonrpc":"2.0","id":2,"method":"tool/exec","params":{"name":"echo","arguments":{"text":"Hello, World!"}}}' | mcp-cmdex

# ファイル読み取り
echo '{"jsonrpc":"2.0","id":3,"method":"tool/exec","params":{"name":"read_file","arguments":{"path":"/path/to/file"}}}' | mcp-cmdex

# コマンド実行
echo '{"jsonrpc":"2.0","id":4,"method":"tool/exec","params":{"name":"execute_command","arguments":{"command":"ls -l"}}}' | mcp-cmdex
```

## ライセンス

Apache License 2.0