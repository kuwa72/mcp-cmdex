/**
 * MCP Server テスト用スクリプト
 * 
 * child_processを使用して、MCP準拠のサーバーをサブプロセスとして起動し、
 * JSON-RPC 2.0形式のメッセージを標準入出力を介して通信をテストします。
 */

const { spawn } = require('child_process');

// サーバープロセスを起動
const mcpServer = spawn('node', ['index.js']);
let messageId = 1;
let testsPassed = 0;
let totalTests = 3;

// エラー出力を監視
mcpServer.stderr.on('data', (data) => {
  console.log(`[Server Log] ${data.toString().trim()}`);
});

// 標準出力を監視
mcpServer.stdout.on('data', (data) => {
  const responseStr = data.toString().trim();
  console.log(`[Server Response] ${responseStr}`);
  
  try {
    const response = JSON.parse(responseStr);
    
    // テスト結果を評価
    if (response.jsonrpc === '2.0') {
      console.log('✓ JSON-RPC 2.0 protocol format correct');
      testsPassed++;
    }
    
    if (response.result && (response.result.tools || response.result.response)) {
      console.log('✓ Valid result payload');
      testsPassed++;
    }
    
    // すべてのテストが完了したら終了
    if (messageId > totalTests) {
      setTimeout(() => {
        console.log('\nTest summary:');
        console.log(`Passed: ${testsPassed} / ${totalTests + 2}`);
        console.log('\nTest completed, terminating server...');
        mcpServer.kill('SIGTERM');
      }, 500);
    }
  } catch (err) {
    console.error('Error parsing server response:', err.message);
  }
});

// サーバープロセスの終了を監視
mcpServer.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// テストメッセージを送信する関数
function sendMessage(message) {
  console.log(`Sending: ${JSON.stringify(message)}`);
  mcpServer.stdin.write(JSON.stringify(message) + '\n');
}

// 1秒後にテストメッセージを送信
setTimeout(() => {
  // Test 1: tools/list リクエスト
  sendMessage({
    jsonrpc: '2.0',
    id: messageId++,
    method: 'tools/list'
  });
  
  // Test 2: tool/exec リクエスト
  setTimeout(() => {
    sendMessage({
      jsonrpc: '2.0',
      id: messageId++,
      method: 'tool/exec',
      params: {
        name: 'mcp-cmdex/hello',
        arguments: {}
      }
    });
  }, 500);
  
  // Test 3: レガシーサポート（後方互換性）
  setTimeout(() => {
    sendMessage({
      jsonrpc: '2.0',
      id: messageId++,
      method: '/helloworld'
    });
  }, 1000);
  
  // Test 4: 無効なメソッド
  setTimeout(() => {
    sendMessage({
      jsonrpc: '2.0',
      id: messageId++,
      method: 'invalid_method'
    });
  }, 1500);
}, 1000);
