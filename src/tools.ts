import { MCP_SERVER } from './mcp-server.js';
import { z } from 'zod';
import { CATEGORY_NAME_REGEX, ingestMemory, queryMemory } from './memory.js';
import { createToolResults } from './util/mcp.js';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { getCategoryFilePath } from './util/category.js';
import { findAllMemoryNodes } from './util/filesystem.js';

MCP_SERVER.registerTool(
    'query',
    {
        description: `Query memory. IMPORTANT: ALWAYS run this before searching the codebase since it will save you time.
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

MCP_SERVER.registerTool(
    'ingest',
    {
        description: `
After learning something new, you can use this tool to add it to memory. This will make it available for future queries.
You can ingest multiple things at once using this tool, just use bullet points.

IMPORTANT: Any time you have to read documentation or search code to understand something, you should use this tool to add that information to your memory.

Examples of things you might want to add to memory include:
- Important architectural decisions
- Design patterns used in the codebase
- Important files or classes that you learned about
- User preferences or conventions
- Code snippet examples of how to write certain types of code (e.g. unit tests, integration tests)
- Language-specific conventions or idioms

You can add pretty much whatever you want. You should probably avoid adding very specific information about the current task, since memory is persistent and shared between developers.
`.trim(),
        inputSchema: {
            content: z.string().nonempty().describe('The content to ingest into memory. This should be a summary of what you learned, or the information you want to add to memory.')
        }
    },
    async ({ content }) => {
        await ingestMemory(content);
        return createToolResults('Ingested content into memory successfully.');
    }
);

MCP_SERVER.registerTool(
	'list',
	{
		description: 'List all memory categories. You can then use the `get` tool to get the contents of a specific category. You should generally use query instead of list/get unless you know ahead of time which category you want.',
	},
	async () => {
		const results: string[] = [];
		for await (const { categoryName } of findAllMemoryNodes()) {
			results.push(categoryName);
		}
		return createToolResults(...results);
	}
);

MCP_SERVER.registerTool(
	'get',
	{
		description: 'Get the contents of a specific memory category. You should generally use query instead of list/get unless you know ahead of time which category you want.',
		inputSchema: {
			category: z.string().nonempty().regex(CATEGORY_NAME_REGEX).describe('The category to get the contents of. You can find available categories using the `list` tool.')
		}
	},
	async ({ category }) => {
		const filepath = getCategoryFilePath(category);
		if (!fsSync.existsSync(filepath)) {
			return createToolResults(`No memory found for category "${category}". You can use the "list" tool to see available categories.`);
		}

		return createToolResults(await fs.readFile(filepath, 'utf-8'));
	}
);