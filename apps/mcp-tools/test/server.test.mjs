import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.mjs');

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: 'ignore'
  });
  const client = new Client({ name: 'mcp-tools-test-client', version: '0.0.1' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test('tools/list returns exactly the 4 tools', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_history', 'get_news', 'get_odds', 'get_offers'].sort());
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
    }
  });
});

test('tools/call get_odds succeeds and returns JSON content', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'get_odds',
      arguments: { fixture_id: 'fx-2026-10-03-hbc-ngr' }
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.fixture.home, 'Harbour City');
    assert.equal(parsed.fixture.away, 'Northgate Rovers');
    assert.ok(parsed.best_price.home.bookmaker);
  });
});

test('tools/call get_offers with unknown market still returns structured content, not a protocol error', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'get_offers',
      arguments: { market: 'cricket' }
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.match(parsed.error, /No offers for market/);
  });
});
