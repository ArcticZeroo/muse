import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ISamplingMessageData {
    role: 'user' | 'assistant';
    content: string;
}

interface IRetrieveSampledMessageOptions {
    mcpServer: McpServer,
    messages: Array<string | ISamplingMessageData>;
    maxTokens: number;
    systemPrompt?: string;
}

// todo: consider ratelimiting?
export const retrieveSampledMessage = async ({
                                                 mcpServer,
                                                 messages,
                                                 systemPrompt,
                                                 maxTokens
                                             }: IRetrieveSampledMessageOptions): Promise<string> => {
    if (!mcpServer.isConnected()) {
        throw new Error('MCP server is not connected, cannot retrieve sampled message');
    }

    const normalizedMessages = messages.map((message) => {
        if (typeof message === 'string') {
            return {
                role: 'user',
                content: {
                    type: 'text',
                    text: message
                }
            } as const;
        }

        return {
            role: message.role,
            content: {
                type: 'text',
                text: message.content
            }
        } as const;
    });

    const result = await mcpServer.server.createMessage({
        messages: normalizedMessages,
        maxTokens,
        systemPrompt
    });

    if (result.content.type !== 'text') {
        throw new Error('Expected text content from MCP sampling');
    }

    return result.content.text;
};