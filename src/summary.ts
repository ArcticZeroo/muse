import { SUMMARY_FILE_PATH } from './args.js';
import { getCategoryDescriptionPrompt } from './constants/prompts.js';
import { logInfo, retrieveSampledMessage } from './util/mcp.js';
import fs from 'node:fs/promises';

const DESCRIPTION_REGEX = /<DESCRIPTION>(?<description>[\s\S]*?)<\/DESCRIPTION>/;

export const getSummary = async (): Promise<string> => {
    return fs.readFile(SUMMARY_FILE_PATH, 'utf8');
}

export const summarizeCategory = async (categoryName: string, content: string): Promise<string> => {
    const prompt = getCategoryDescriptionPrompt(categoryName, content);

    const response = await retrieveSampledMessage({
        messages: [prompt],
        maxTokens: 1000
    });

    const description = response.match(DESCRIPTION_REGEX)?.groups?.description;
    if (!description) {
        throw new Error('Unable to generate description.');
    }

    return description.trim();
};