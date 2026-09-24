#!/usr/bin/env node
// Stdio MCP server for the Touchline Times demo tools (odds, news, head-to-head history, offers).
//
// Uses the low-level Server class (not the high-level McpServer) on purpose:
// TOOLS in ./tools.mjs declares inputSchema as plain JSON Schema, which is
// exactly the wire format tools/list expects. The high-level McpServer's
// registerTool() requires Zod schemas, which would force converting our
// frozen-seam JSON Schema into Zod for no benefit here. This keeps the
// server with zero direct dependency on zod.
//
// IMPORTANT: nothing may be written to stdout except MCP protocol frames
// (the StdioServerTransport owns stdout). All diagnostics go to stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools.mjs';

const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

// The name the server reports in its MCP initialize response. Claude Code records the name the
// server is registered under (its mcpServers key) as mcp_server.name, so keep the two aligned.
const serverName = process.env.MCP_SERVER_NAME || process.env.SERVICE_NAMESPACE || 'touchline';

const server = new Server(
  { name: serverName, version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolsByName.get(name);

  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }]
    };
  }

  try {
    const result = await tool.handler(args ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }]
    };
  } catch (err) {
    // Handlers are documented to return { error } rather than throw, but
    // guard the protocol boundary anyway rather than crashing the process.
    console.error(`[mcp-tools] handler for ${name} threw:`, err);
    return {
      isError: true,
      content: [
        { type: 'text', text: JSON.stringify({ error: `Internal error running ${name}` }) }
      ]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp-tools] ${serverName} MCP server ready on stdio`);
}

main().catch((err) => {
  console.error('[mcp-tools] fatal error starting server:', err);
  process.exit(1);
});
