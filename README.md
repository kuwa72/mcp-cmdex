# MCP-CMDEX

よく配布されているMCPサーバーの例を参考にDenoで実装したMCPサーバーです。

## 機能

* filesystem
* fetch
* hello

## インストール

配布されている`echo_mcp`を実行ファイルとして使用してください。

自力でコンパイルする場合は以下のコマンドを実行してください。

```bash
deno task build
```

## 使用方法

実行ファイルを指定する

```
		"misc": {
			"command": "/Users/ykuwashima/ghq/github.com/kuwa72/mcp-cmdex/echo_mcp",
			"disabled": false,
			"alwaysAllow": []
		}
```

filesystemがアクセス可能なディレクトリは設定ファイルで指定します。
Mac, Windowsで設定ファイルは以下の場所にあります。

* Mac: `~/.mcp-cmdex.toml`
* Windows: `%USERPROFILE%/.mcp-cmdex.toml`

```toml
allowedDirectories = ["/path/to/directory", "/path/to/another/directory"]
```

### 試すには

```bash
# ツール一覧を取得
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | mcp-cmdex

# ツールを実行
echo '{"jsonrpc":"2.0","id":2,"method":"tool/exec","params":{"name":"mcp-cmdex/hello","arguments":{}}}' | mcp-cmdex
```

## ライセンス

Apache License 2.0