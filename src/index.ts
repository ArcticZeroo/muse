import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCP_SERVER } from './mcp-server.js';
import { ensureGitignore } from './gitignore.js';
import { startVersioningWatcher } from './versioning.js';
import './tools.js';

const transport = new StdioServerTransport();
await MCP_SERVER.connect(transport);

await startVersioningWatcher();

await ensureGitignore();