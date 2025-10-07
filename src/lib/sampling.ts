import { CATEGORY_NAME_TAG, CATEGORY_TAG, WHAT_TO_INCLUDE_TAG, TagRegexManager } from './constants/regex.js';
import { isCategoryMissing } from './util/category.js';
import { IMemoryConfig } from './models/session.js';
import { MemorySession } from './session.js';
import { retrieveSampledMessage } from './util/sampling.js';

interface IGetCategoriesForQueryOptions {
    session: MemorySession;
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
        const reason = WHAT_TO_INCLUDE_TAG.matchOne(categoryContent);

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
                                                session,
                                                summary,
                                                query,
                                                isIngestion,
                                                existingOnly = false
                                            }: IGetCategoriesForQueryOptions): Promise<Array<IQueryCategory>> => {
    const prompt = await session.prompts.getCategoriesFromQueryPrompt(summary, query, isIngestion);

    const response = await retrieveSampledMessage({
        session,
        messages: [prompt],
        maxTokens: 5000
    });

    return parseQueryCategories(session.config, CATEGORY_TAG, response, existingOnly);
};
