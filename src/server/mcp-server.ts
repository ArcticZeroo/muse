import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const MCP_SERVER = new McpServer(
    {
        name:    'muse',
        version: '0.0.1'
    },
    {
        capabilities: {
            logging: {
                setLevel: true
            },
            resources: {},
            tools:     {},
            sampling:  {}
        }
    }
);

// Without handling this request, the MCP server will throw a "method not found" error when a client tries to set the
// logging level. This causes the MCP inspector to fail to connect, so we provide a no-op handler here.
// ...eventually we might want to implement this properly.
MCP_SERVER.server.setRequestHandler(SetLevelRequestSchema, () => ({}));