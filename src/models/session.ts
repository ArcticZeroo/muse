import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface IMemoryConfig {
    server: McpServer;
    memoryDirectory: string;
    contextFilePath?: string;
    summaryFilePath: string;
    userFilePath: string;
    versionsFilePath: string;
}
