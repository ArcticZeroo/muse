import { CallToolResult, LoggingMessageNotification } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type LogLevels = LoggingMessageNotification['params']['level'];

export class McpLogger {
    readonly #mcpServer: McpServer;

    constructor(server: McpServer) {
        this.#mcpServer = server;
    }

    #log(message: string, level: LogLevels, ifNotConnected: (message: string) => void) {
        if (!this.#mcpServer.isConnected()) {
            ifNotConnected(message);
            return;
        }

        this.#mcpServer.server.sendLoggingMessage({
            level,
            data: message
        }).catch(err => console.error('Failed to send log message to MCP server:', err));
    }

    logInfo(message: string) {
        this.#log(message, 'info', console.log);
    }

    logError(message: string) {
        this.#log(message, 'error', console.error);
    }

    logDebug(message: string) {
        this.#log(message, 'debug', console.debug);
    }

    logWarn(message: string) {
        this.#log(message, 'warning', console.warn);
    }
}


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

export const createToolResults = (...message: string[]): CallToolResult => {
    return {
        content: message.map((text) => ({
            type: 'text',
            text
        }))
    };
};
