import { getCategoriesFromQueryPrompt } from './constants/prompts.js';
import { CATEGORY_NAME_TAG, CATEGORY_TAG, REASON_TAG, TagRegexManager } from './constants/regex.js';
import { retrieveSampledMessage } from './util/mcp.js';
import { isCategoryMissing } from './util/category.js';
import { IMemoryConfig } from './models/session.js';

interface IGetCategoriesForQueryOptions {
    config: IMemoryConfig;
    summary: string;
    query: string;
    isIngestion: boolean;
    existingOnly?: boolean;
}

export interface IQueryCategory {
    categoryName: string;
    reason: string;
}

export const parseQueryCategories = (config: IMemoryConfig, tag: TagRegexManager, response: string, existingOnly: boolean = false): Array<IQueryCategory> => {
    const categories: Array<IQueryCategory> = [];

    tag.forEach(response, (categoryContent) => {
        const categoryName = CATEGORY_NAME_TAG.matchOne(categoryContent);
        const reason = REASON_TAG.matchOne(categoryContent);

        if (!categoryName || !reason) {
            throw new Error(`AI generated an invalid category block: ${categoryContent}`);
        }

        if (existingOnly && isCategoryMissing(config, categoryName)) {
            throw new Error(`AI asked for a category "${categoryName}" which is missing`);
        }

        categories.push({ categoryName, reason });
    });

    return categories;
};

export const getCategoriesForQuery = async ({
                                                config,
                                                summary,
                                                query,
                                                isIngestion,
                                                existingOnly = false
                                            }: IGetCategoriesForQueryOptions): Promise<Array<IQueryCategory>> => {
    const prompt = getCategoriesFromQueryPrompt(summary, query, isIngestion);

    const response = await retrieveSampledMessage({
        messages: [prompt],
        maxTokens: 5000
    });

    return parseQueryCategories(config, CATEGORY_TAG, response, existingOnly);
};
