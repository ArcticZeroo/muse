import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'node:path';
import { SUMMARY_FILE_NAME, USER_FILE_NAME, VERSIONS_FILE_NAME } from './constants/files.js';
import fsSync from 'fs';
import fs from 'node:fs/promises';

interface IProgramArgs {
    outputDirectory: string;
    contextFilePath?: string;
}

export const parseMuseArgs = async (): Promise<IProgramArgs> => {
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

    const outputDirectory = argv.out;
    if (!outputDirectory || typeof outputDirectory !== 'string') {
        throw new Error('Output directory must be specified');
    }

    return {
        outputDirectory,
        contextFilePath: argv.context
    };
};