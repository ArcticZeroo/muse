import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCP_SERVER } from './mcp-server.js';
import { ensureGitignore } from './gitignore.js';
import { ensureSummary } from './summary.js';
import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY } from './args.js';
import './tools.js';
import { watchForChanges } from './watcher.js';

await fs.mkdir(MEMORY_DIRECTORY, { recursive: true });

await ensureGitignore();

const transport = new StdioServerTransport();
await MCP_SERVER.connect(transport);

await ensureSummary();

watchForChanges()
	.catch(err => console.error('File watcher error:', err));