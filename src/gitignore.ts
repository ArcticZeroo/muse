import path from 'node:path';
import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY } from './args.js';
import { USER_FILE_NAME } from './constants/files.js';
import fsSync from 'fs';
import { logInfo } from './util/mcp.js';

export const ensureGitignore = async () => {
    const gitignorePath = path.join(MEMORY_DIRECTORY, '.gitignore');

    if (!fsSync.existsSync(gitignorePath)) {
        await fs.writeFile(gitignorePath, USER_FILE_NAME, 'utf-8');
        return;
    }

    logInfo('Gitignore file already exists, skipping creation.');

//     const handle = await fs.open(gitignorePath, 'a+');
//     try {
//         for await (const line of handle.readLines()) {
//             if (line.trim() === USER_FILE_NAME) {
//                 // If the line already exists, we don't need to add it again
//                 return;
//             }
//         }
//
//         // If we reach here, the line does not exist, so we append it
//         await handle.appendFile(`\n${USER_FILE_NAME}\n`);
//     } finally {
//         await handle.close();
//     }
}