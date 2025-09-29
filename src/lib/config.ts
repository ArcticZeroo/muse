import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { IMemoryConfig } from './models/session.js';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { SUMMARY_FILE_NAME, USER_FILE_NAME, VERSIONS_FILE_NAME } from './constants/files.js';

export const createConfigAsync = async (server: McpServer, memoryDirectory: string, contextFilePath?: string): Promise<IMemoryConfig> => {
    if (!memoryDirectory) {
        throw new Error('Memory directory must be non-empty');
    }

    memoryDirectory = path.resolve(memoryDirectory);

    if (contextFilePath) {
        contextFilePath = path.resolve(memoryDirectory, contextFilePath);

        if (!fsSync.existsSync(contextFilePath)) {
            throw new Error(`Context file does not exist: ${contextFilePath}`);
        }
    }

    await fs.mkdir(memoryDirectory, { recursive: true });

    const summaryFilePath = path.resolve(memoryDirectory, SUMMARY_FILE_NAME);
    const userFilePath = path.resolve(memoryDirectory, USER_FILE_NAME);
    const versionsFilePath = path.resolve(memoryDirectory, VERSIONS_FILE_NAME);

    return {
        server,
        memoryDirectory,
        contextFilePath,
        summaryFilePath,
        userFilePath,
        versionsFilePath
    };
};
