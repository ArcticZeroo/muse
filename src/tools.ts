import { MCP_SERVER } from './mcp-server.js';
import { z } from 'zod';
import { queryMemory } from './memory.js';
import { createToolResults } from './util/mcp.js';

MCP_SERVER.registerTool(
    'query',
    {
        description: `Query memory. ALWAYS run this before searching the codebase since it will save you time.
        Memory is always being updated, so it may not necessarily contain what you need, but it may contain:
        - Architecture, design decision, or feature information
        - Important files, classes, or functions
        - User preferences
        - Examples of how to write certain types of code (e.g. unit tests)
        
        You will need to include information about your current task in the query, and can query multiple things at once (just use bullet points).`,
        inputSchema: {
            query: z.string().nonempty().describe('The query to run against memory.')
        }
    },
    async ({ query }) => {
        return createToolResults(await queryMemory(query));
    }
);