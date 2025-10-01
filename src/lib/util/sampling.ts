import { MemorySession } from '../session.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import Bottleneck from 'bottleneck';

export interface ISamplingMessageData {
    role: 'user' | 'assistant';
    content: string;
}

interface IRetrieveSampledMessageOptions {
    session: MemorySession;
    messages: Array<string | ISamplingMessageData>;
    maxTokens: number;
    systemPrompt?: string;
}

const retrieveSampledMessageInner = async ({
                                                 session,
                                                 messages,
                                                 systemPrompt,
                                                 maxTokens
                                             }: IRetrieveSampledMessageOptions): Promise<string> => {
    const mcpServer = session.config.server;
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

    try {
        const result = await mcpServer.server.createMessage({
            messages: normalizedMessages,
            maxTokens,
            systemPrompt
        });

        if (result.content.type !== 'text') {
            throw new Error('Expected text content from MCP sampling');
        }

        return result.content.text;
    } catch (err) {
        if (err instanceof McpError && err.code === -32000) {
            session.memoryEvents.emit('permissionDenied');
        }

        throw err;
    }
};

const limiter = new Bottleneck({
    maxConcurrent: 5, // Limit to 5 concurrent requests no matter how long they take
    minTime: 500, // 500ms between requests
});

export const retrieveSampledMessage = limiter.wrap(retrieveSampledMessageInner);