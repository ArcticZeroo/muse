import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'node:path';
import { SUMMARY_FILE_NAME, USER_FILE_NAME, VERSIONS_FILE_NAME } from './constants/files.js';
import fsSync from 'fs';
import fs from 'node:fs/promises';

const argv = await yargs(hideBin(process.argv))
    // .scriptName('mcp-server')
    .command('$0 <out>', 'Run the MCP server', (yargs) => {
        return yargs.positional('out', {
            describe: 'Directory to store memory files',
            type: 'string',
            demandOption: true
        });
    })
    .option('context', {
        describe: 'Path to a file containing context for the AI when considering memory',
        type: 'string',
        alias: 'c'
    })
    .parse();

const outDir = argv.out;
if (!outDir || typeof outDir !== 'string') {
    throw new Error('Output directory must be specified');
}

export const MEMORY_DIRECTORY = outDir;
export const CONTEXT_FILE_PATH = argv.context ? path.resolve(argv.context) : undefined;

export const SUMMARY_FILE_PATH = path.resolve(path.join(MEMORY_DIRECTORY, SUMMARY_FILE_NAME));
export const USER_FILE_PATH = path.resolve(path.join(MEMORY_DIRECTORY, USER_FILE_NAME));
export const VERSIONS_FILE_PATH = path.resolve(path.join(MEMORY_DIRECTORY, VERSIONS_FILE_NAME));

if (CONTEXT_FILE_PATH && !fsSync.existsSync(CONTEXT_FILE_PATH)) {
    throw new Error(`Context file does not exist: ${CONTEXT_FILE_PATH}`);
}

await fs.mkdir(MEMORY_DIRECTORY, { recursive: true });
