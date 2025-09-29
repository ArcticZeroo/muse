import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const createToolResults = (...message: string[]): CallToolResult => {
    return {
        content: message.map((text) => ({
            type: 'text',
            text
        }))
    };
};
