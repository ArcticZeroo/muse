import path from 'node:path';
import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY } from './args.js';
import { USER_FILE_NAME } from './constants/files.js';
import fsSync from 'fs';

const requiredGitignoreLines = [
	USER_FILE_NAME
];

export const ensureGitignore = async () => {
    const gitignorePath = path.join(MEMORY_DIRECTORY, '.gitignore');

    if (!fsSync.existsSync(gitignorePath)) {
        await fs.writeFile(gitignorePath, requiredGitignoreLines.join('\n'), 'utf-8');
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

	await fs.appendFile(gitignorePath, `\n${Array.from(remainingLines).join('\n')}\n`);
}