import path from 'node:path';
import fs from 'node:fs/promises';
import { USER_FILE_NAME } from './constants/files.js';
import fsSync from 'fs';
import { IMemoryConfig } from './models/session.js';

const requiredGitignoreLines = [
	USER_FILE_NAME
];

export const ensureGitignore = async (config: IMemoryConfig) => {
    const gitignorePath = path.join(config.memoryDirectory, '.gitignore');

    if (!fsSync.existsSync(gitignorePath)) {
        await fs.writeFile(gitignorePath, requiredGitignoreLines.join('\r\n'), 'utf-8');
        return;
    }

	const remainingLines = new Set(requiredGitignoreLines);
    const handle = await fs.open(gitignorePath, 'r');
    try {
        for await (const line of handle.readLines()) {
			remainingLines.delete(line.trim());

			if (remainingLines.size === 0) {
				return;
			}
        }
    } finally {
        await handle.close();
    }

	await fs.appendFile(gitignorePath, `\n${Array.from(remainingLines).join('\r\n')}\r\n`);
}