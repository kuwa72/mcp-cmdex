# MCP-CMDEX

Model Context Protocol (MCP)の仕様に準拠したstdio対応サーバーで、拡張コマンドを提供します。

## 機能

* MCP準拠のJSON-RPC 2.0プロトコルを実装
* `mcp-cmdex/hello` ツールを提供（"Hello World"文字列を返す）
* `tools/list` と `tool/exec` メソッドをサポート
* レガシー形式（`/helloworld`）も後方互換性のためにサポート

## MCPについて

Model Context Protocol (MCP)は、AIモデルと外部ツールやリソースを接続するための標準化されたプロトコルです。

* JSON-RPC 2.0をベースにした通信プロトコル
* stdioやHTTP/SSEなどの複数のトランスポートをサポート
* ツールの宣言とスキーマ定義を通じた拡張性

## インストール

```bash
# グローバルインストール
npm install -g .

# または、開発用にローカルでリンク
npm link
```

## 使用方法

### JSON-RPC 2.0リクエストを送信

```bash
# ツール一覧を取得
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | mcp-cmdex

# ツールを実行
echo '{"jsonrpc":"2.0","id":2,"method":"tool/exec","params":{"name":"mcp-cmdex/hello","arguments":{}}}' | mcp-cmdex
```

### プログラムから使用

```javascript
const { spawn } = require('child_process');
const mcpServer = spawn('mcp-cmdex');
let messageId = 1;

// JSON-RPC 2.0メッセージを送信する関数
function sendRequest(method, params = undefined) {
  const request = {
    jsonrpc: '2.0',
    id: messageId++,
    method
  };
  
  if (params) {
    request.params = params;
  }
  
  mcpServer.stdin.write(JSON.stringify(request) + '\n');
}

// 標準出力からレスポンスを読み取る
mcpServer.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log('Response:', response);
  
  if (response.result && response.result.tools) {
    // ツール一覧が取得できた場合、ツールを実行
    const tool = response.result.tools.find(t => t.name === 'mcp-cmdex/hello');
    if (tool) {
      sendRequest('tool/exec', {
        name: tool.name,
        arguments: {}
      });
    }
  }
});

// エラー出力も監視
mcpServer.stderr.on('data', (data) => {
  console.error(`Server Log: ${data}`);
});

// ツール一覧をリクエスト
sendRequest('tools/list');
```

## MCPメッセージフォーマット

### リクエスト

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "method": "tools/list" | "tool/exec" | "/helloworld",
  "params": {
    // tool/execの場合
    "name": "mcp-cmdex/hello",
    "arguments": {}
  }
}
```

### レスポンス

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "result": {
    // tools/listの場合
    "tools": [
      {
        "name": "mcp-cmdex/hello",
        "description": "Returns \"Hello World\" when called.",
        "parameters": {
          "type": "object",
          "properties": {},
          "required": []
        }
      }
    ]
    // tool/execの場合
    "response": "Hello World"
  }
}
```

### エラーレスポンス

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "error": {
    "code": -32601,
    "message": "Method not found: invalid_method"
  }
}
```

## 開発

```bash
# 依存関係のインストール
npm install

# 開発中の実行
npm start

# テストの実行
npm test
```

## 参考資料

* [Model Context Protocol (MCP) 仕様](https://spec.modelcontextprotocol.io/specification/2024-11-05/)
* [JSON-RPC 2.0 仕様](https://www.jsonrpc.org/specification)
* [MCPサーバー開発ガイド](https://modelcontextprotocol.io/docs/guides/server-guide)

## 拡張方法

新しいツールを追加するには、`index.js` の `MCPServer` クラスの `constructor` 内にある `tools` オブジェクトに定義を追加し、`handleToolExec` メソッドに処理ロジックを実装します。

例えば、日付と時刻を返すツールを追加する場合：

```javascript
this.tools = {
  'mcp-cmdex/hello': { ... },
  
  // 新しいツールを追加
  'mcp-cmdex/datetime': {
    description: '現在の日付と時刻を返します。',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: '日付フォーマット（例："ISO"、"localized"）',
          default: 'ISO'
        }
      },
      required: []
    }
  }
};
```

そして、`handleToolExec` メソッドに処理ロジックを追加します：

```javascript
handleToolExec(id, params) {
  if (!params || !params.name) {
    return this.sendError(id, -32602, 'Invalid params: Tool name not provided');
  }
  
  const { name, arguments: args = {} } = params;
  
  switch (name) {
    case 'mcp-cmdex/hello':
      this.sendResult(id, { response: 'Hello World' });
      break;
      
    case 'mcp-cmdex/datetime':
      const format = args.format || 'ISO';
      let dateStr;
      
      if (format === 'ISO') {
        dateStr = new Date().toISOString();
      } else if (format === 'localized') {
        dateStr = new Date().toLocaleString();
      } else {
        dateStr = new Date().toString();
      }
      
      this.sendResult(id, { response: dateStr });
      break;
      
    default:
      this.sendError(id, -32601, `Tool not found: ${name}`);
  }
}
```

## ライセンス

ISC
