#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCP_SERVER } from './mcp-server.js';
import './tools.js';
import { MemorySession } from '../lib/session.js';
import { parseMuseArgs } from '../lib/args.js';
import { registerTools } from './tools.js';

const args = await parseMuseArgs();

const transport = new StdioServerTransport();
await MCP_SERVER.connect(transport);

const session = await MemorySession.createAsync({
    server: MCP_SERVER,
    memoryDirectory: args.outputDirectory,
    contextFilePath: args.contextFilePath
});

registerTools(session);