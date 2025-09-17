import fsSync from 'fs';
import { SUMMARY_FILE_PATH } from './args.js';
import { getCategoryDescriptionPrompt, getUpdateSummaryPrompt } from './constants/prompts.js';
import { logInfo, retrieveSampledMessage } from './util/mcp.js';
import { USER_CATEGORY_NAME } from './constants/files.js';
import fs from 'node:fs/promises';
import { readAllMemory } from './util/filesystem.js';

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

    logInfo(`Response for category ${categoryName}: ${response}`);

    const description = response.match(DESCRIPTION_REGEX)?.groups?.description;
    if (!description) {
        return 'Unable to generate description.';
    }

    return description.trim();
};

export const ensureSummary = async () => {
    logInfo('Ensuring summary file exists...');
    if (!fsSync.existsSync(SUMMARY_FILE_PATH)) {
        logInfo('Summary file does not exist, generating summary...');
        const memory = await readAllMemory();
        logInfo('All memory loaded, summarizing categories...');
        const summaries: Record<string, string> = {};
        const summaryPromises: Array<Promise<void>> = [];
        for (const [categoryName, content] of Object.entries(memory)) {
            logInfo(`Summarizing ${categoryName}`);
            summaryPromises.push(summarizeCategory(categoryName, content).then(summary => {
                logInfo(`Summary for ${categoryName} generated.`);
                summaries[categoryName] = summary;
            }));
        }
        await Promise.all(summaryPromises);
        const contents: string[] = [];
        const categories = Object.keys(summaries).sort((a, b) => a.localeCompare(b));
        for (const category of categories) {
            contents.push(`### ${category}\n\n${summaries[category]}\n`);
        }
        contents.push(`### ${USER_CATEGORY_NAME}\n\nThis category contains information about the user and their specific preferences.`);
        fsSync.writeFileSync(SUMMARY_FILE_PATH, contents.join('\n'), 'utf-8');
        logInfo('Summary file updated successfully.');
    }

    // todo: ensure consistency with previous summary, files could be edited at any time from under us
};

const UPDATED_SUMMARY_REGEX = /<UPDATED_SUMMARY>(?<updatedSummary>[\s\S]*?)<\/UPDATED_SUMMARY>/;

export const updateSummary = async (summary: string, updatedCategoryDescriptions: Record<string /*categoryName*/, string /*summary*/>) => {
    if (Object.keys(updatedCategoryDescriptions).length === 0) {
        return;
    }

    const prompt = getUpdateSummaryPrompt(summary, updatedCategoryDescriptions);
    const response = await retrieveSampledMessage({
        messages: [prompt],
        maxTokens: 50_000
    });

    const updatedSummary = response.match(UPDATED_SUMMARY_REGEX)?.groups?.updatedSummary.trim();
    if (!updatedSummary) {
        throw new Error('Failed to update summary: no updated summary found in response.');
    }

    await fs.writeFile(SUMMARY_FILE_PATH, updatedSummary, 'utf-8');
};