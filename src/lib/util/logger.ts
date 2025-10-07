import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LoggingMessageNotification } from '@modelcontextprotocol/sdk/types.js';

type LogLevels = LoggingMessageNotification['params']['level'];

export class McpLogger {
    readonly #mcpServer: McpServer;

    constructor(server: McpServer) {
        this.#mcpServer = server;
    }

    #log(message: string, level: LogLevels) {
        if (!this.#mcpServer.isConnected()) {
            return;
        }

        this.#mcpServer.server.sendLoggingMessage({
            level,
            data: message
        }).catch(err => console.error('Failed to send log message to MCP server:', err));
    }

    info(message: string) {
        return this.#log(message, 'info');
    }

    error(message: string) {
        return this.#log(message, 'error');
    }

    debug(message: string) {
        return this.#log(message, 'debug');
    }

    warn(message: string) {
        return this.#log(message, 'warning');
    }
}