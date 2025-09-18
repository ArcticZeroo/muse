import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCP_SERVER } from './mcp-server.js';
import { ensureGitignore } from './gitignore.js';
import { watchForChanges } from './watcher.js';
import './tools.js';
import { logInfo } from './util/mcp.js';

await ensureGitignore();

const transport = new StdioServerTransport();
await MCP_SERVER.connect(transport);

logInfo('Ready!');

watchForChanges()
	.catch(err => console.error('File watcher error:', err));