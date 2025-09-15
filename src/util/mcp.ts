import { MCP_SERVER } from '../mcp-server.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const logInfo = (message: string) => {
    if (!MCP_SERVER.isConnected()) {
        console.log(message);
        return;
    }

    MCP_SERVER.server.sendLoggingMessage({
        level: 'info',
        data: message
    });
};

export interface ISamplingMessageData {
    role:    'user' | 'assistant';
    content: string;
}

interface IRetrieveSampledMessageOptions {
    messages: Array<string | ISamplingMessageData>;
    maxTokens: number;
    systemPrompt?: string;
}

export const retrieveSampledMessage = async ({ messages, systemPrompt, maxTokens }: IRetrieveSampledMessageOptions): Promise<string> => {
    const normalizedMessages = messages.map((message) => {
        if (typeof message === 'string') {
            return {
                role:    'user',
                content: {
                    type: 'text',
                    text: message
                }
            } as const;
        }

        return {
            role:    message.role,
            content: {
                type: 'text',
                text: message.content
            }
        } as const;
    });

    const result = await MCP_SERVER.server.createMessage({
        messages: normalizedMessages,
        maxTokens,
        systemPrompt
    });

    if (result.content.type !== 'text') {
        throw new Error('Expected text content from MCP sampling');
    }

    return result.content.text;
};

export const createToolResults = (...message: string[]): CallToolResult => {
    return {
        content: message.map((text) => ({
            type: 'text',
            text
        }))
    };
};
