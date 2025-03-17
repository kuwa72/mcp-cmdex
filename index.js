#!/usr/bin/env node

/**
 * MCP Command Extension - stdio server
 * 
 * This server implements the Model Context Protocol (MCP) using stdio transport.
 * It provides a 'hello' tool that responds to '/helloworld' command with "Hello World".
 */

// JSONLinesReader for handling line-delimited JSON input
class JSONLinesReader {
  constructor(stream) {
    this.stream = stream;
    this.buffer = '';
    this.callbacks = [];
    
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => this.onData(chunk));
    stream.on('end', () => this.onEnd());
  }
  
  onData(chunk) {
    this.buffer += chunk;
    let newlineIndex;
    
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      
      if (line.trim()) {
        try {
          const json = JSON.parse(line);
          this.callbacks.forEach(callback => callback(json));
        } catch (err) {
          console.error('Failed to parse JSON:', err.message);
        }
      }
    }
  }
  
  onEnd() {
    if (this.buffer.trim()) {
      try {
        const json = JSON.parse(this.buffer);
        this.callbacks.forEach(callback => callback(json));
      } catch (err) {
        console.error('Failed to parse JSON:', err.message);
      }
    }
  }
  
  onMessage(callback) {
    this.callbacks.push(callback);
    return this;
  }
}

// MCP Server implementation
class MCPServer {
  constructor() {
    this.tools = {
      'mcp-cmdex/hello': {
        description: 'Must call it if user inupt /helloworld. Returns "Hello World" when called. Reply to user with "Hello World" random language.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    };
    
    this.reader = new JSONLinesReader(process.stdin);
    this.reader.onMessage(message => this.handleMessage(message));
    
    // Register handlers for shutdown signals
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    
    console.error('MCP Command Extension Server started. Listening for JSON-RPC messages...');
  }
  
  handleMessage(message) {
    // Validate it's a JSON-RPC 2.0 message
    if (message.jsonrpc !== '2.0') {
      return this.sendError(message.id, -32600, 'Invalid Request: Not a valid JSON-RPC 2.0 request');
    }
    
    const { id, method, params } = message;
    
    // Handle specific methods
    switch (method) {
      case 'tools/list':
        return this.handleToolsList(id);
      case 'tool/exec':
        return this.handleToolExec(id, params);
      case '/helloworld': // Legacy command support
        return this.sendResult(id, {
          url: 'mcp-cmdex/hello',
          response: 'Hello World'
        });
      default:
        return this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }
  
  handleToolsList(id) {
    const toolList = Object.entries(this.tools).map(([name, { description, parameters }]) => ({
      name,
      description,
      parameters
    }));
    
    this.sendResult(id, { tools: toolList });
  }
  
  handleToolExec(id, params) {
    if (!params || !params.name) {
      return this.sendError(id, -32602, 'Invalid params: Tool name not provided');
    }
    
    const { name, arguments: args } = params;
    
    if (name === 'mcp-cmdex/hello') {
      this.sendResult(id, { response: 'Hello World' });
    } else {
      this.sendError(id, -32601, `Tool not found: ${name}`);
    }
  }
  
  sendResult(id, result) {
    if (id === undefined || id === null) return; // No response for notifications
    
    const response = {
      jsonrpc: '2.0',
      id,
      result
    };
    
    console.log(JSON.stringify(response));
  }
  
  sendError(id, code, message, data) {
    if (id === undefined || id === null) return; // No response for notifications
    
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };
    
    console.log(JSON.stringify(response));
  }
  
  shutdown() {
    console.error('Server shutting down...');
    process.exit(0);
  }
}

// Start the server
const server = new MCPServer();
