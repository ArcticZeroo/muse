import fs from 'node:fs/promises';
import { USER_CATEGORY_NAME } from './files.js';
import { ifTruthy } from '../util/string.js';
import { IMemoryConfig } from '../models/session.js';

const describeSummary = (summary: string) => summary.trim()
    ? summary
    : 'No categories exist yet.';

const CONTEXT_REFRESH_INTERVAL_MS = 1000 * 60; // 1 minute

const SUMMARY_DESCRIPTION_EXPLANATION = `The description should be concise and informative, summarizing the purpose and contents of the category. It will be included in the main summary file so that you can easily determine when to (and when not to) use this category for data retrieval/storage. This description can contain links to other categories, but should not contain any information that is not already in the category content. The description may also contain specific instructions on when it is important to use this category, or when it is not appropriate to use this category.`;

interface IGetInformationFromSingleCategoryPromptOptions {
    query: string;
    categoryName: string;
    content: string;
    reason: string;
}

interface IGetUpdateInSingleCategoryPromptOptions {
    categoryName: string;
    previousCategoryContent?: string;
    summary: string;
    information: string;
    reason: string;
}

export class PromptManager {
    readonly #config: IMemoryConfig;
    #contextLastRetrievedTime: number = 0;
    #context: string = '';

    constructor(config: IMemoryConfig) {
        this.#config = config;
    }

    async #readContext() {
        if (!this.#config.contextFilePath) {
            return undefined;
        }

        const timeSinceLastRead = Date.now() - this.#contextLastRetrievedTime;
        if (timeSinceLastRead >= CONTEXT_REFRESH_INTERVAL_MS) {
            this.#contextLastRetrievedTime = Date.now();
            this.#context = await fs.readFile(this.#config.contextFilePath, 'utf-8');
        }

        return this.#context;
    }

    async #getContextPrompt(): Promise<string> {
        const context = await this.#readContext();
        if (!context) {
            return '';
        }

        return `
The user has provided the following common context to help you answer questions and find information:
<CONTEXT>
${context}
</CONTEXT>
        `.trim();
    }

    async #getSystemPrompt(): Promise<string> {
        const contextPrompt = await this.#getContextPrompt();
        return `
You are an expert archivist whose job is to store and retrieve information about a codebase and the user from a vast archive of knowledge. You assist users in finding the information they need, answering questions, and providing insights based on the data available to you.
Information is separated into categories and stored as markdown. These categories may be separated by feature, programming language, or other factors. Categories can be nested, e.g. languages/cpp, feature/networking or feature/networking/HTTP. Each category has its own file, and the content of these files is updated as new information is added.
There is a main "summary" file which contains an overall listing of categories. The special ${USER_CATEGORY_NAME} category contains information about the user, such as their preferences, interests, and other relevant details.

${contextPrompt}
`.trim();
    }

    async getCategoryDescriptionPrompt(categoryName: string, content: string) {
        return `
${await this.#getSystemPrompt()}
Your current task is to produce a description for a category based on the content provided.
${SUMMARY_DESCRIPTION_EXPLANATION}

You should return a <DESCRIPTION> tag containing the description, e.g. <DESCRIPTION>description in here</DESCRIPTION>.

<CONTENT categoryName="${categoryName}">
${content}
</CONTENT>
`.trim();
    }

    async getCategoriesFromQueryPrompt(summary: string, information: string, isIngestion: boolean) {
        return `
${await this.#getSystemPrompt()}
Your current task is to identify the categories that this information belongs to for lookup and storage. 

Here is the information:
<INFORMATION>
${information}
</INFORMATION>

Here is a summary of the existing categories and what they're for:
<SUMMARY>
${describeSummary(summary)}
</SUMMARY>

${isIngestion ? 'You will provide 1 or more' : 'It is possible that no categories match the information. If any categories do match, provide them as'} <CATEGORY> tags, each containing a <CATEGORY_NAME></CATEGORY_NAME> tag, and a <REASON></REASON> tag explaining why you chose that category. 
The reason will be used in the next step to determine what information to retrieve/store in that category, so be as specific as possible. For example, if the information is about a specific function or class, mention that in the reason. If the information is about a specific feature, mention that in the reason. If the information is about a specific programming language, mention that in the reason.
${isIngestion ? 'You can create new categories if necessary to encompass the information, but try to group with existing categories where it makes sense. New categories must match /[\\w-]+/ since they are used as file names.' : 'You may only specify categories that already exist.'}
`.trim();
    }

    async getInformationFromSingleCategoryPrompt({
                                                     query,
                                                     categoryName,
                                                     content,
                                                     reason
                                                 }: IGetInformationFromSingleCategoryPromptOptions) {
        return `
${await this.#getSystemPrompt()}
Your current task is to answer a question/find some information based on the information available in the archive.
 
<QUERY>
${query}
</QUERY>

<ARCHIVE_CONTENT categoryName="${categoryName}">
${content}
</ARCHIVE_CONTENT>

This category has been selected with the following reason:
<REASON>
${reason}
</REASON>

Use this reason to help you determine what information, if any, is relevant to the query.

You will return an <ANSWER> tag containing the answer to the question, e.g. <ANSWER>answer in here</ANSWER>. It is ok if you only have a partial answer to the question - we will look at other categories too.
If this category doesn't answer anything, return a <SKIP> tag instead of an <ANSWER> tag, e.g. <SKIP>information not found</SKIP>.

If this archive directly references other category names that you think would help answer the question, you may optionally also return any number of <CATEGORY_REFERENCE> tags containing the category name in <CATEGORY_NAME> and the reason why you think it is relevant in <REASON>.
For example, <CATEGORY_REFERENCE><CATEGORY_NAME>name</CATEGORY_NAME><REASON>Category my_cool_feature references this category for more information about some_other_feature</REASON></CATEGORY_REFERENCE>. These should be outside the <ANSWER> tag. 
Do not return category references unless the category is explicitly mentioned in this archive. 
Category references may be returned even if you are returning a <SKIP> tag.
`.trim();
    }

    async getSummarizeInformationFromManyCategoriesPrompt(query: string, categories: Record<string /*categoryName*/, string /*content*/>) {
        return `
${await this.#getSystemPrompt()}
Your current task is to answer a question/find some information based on the information available in the archive.
We have already retrieved partial answers from the categories that are most relevant to the question, and now we need to summarize the information from these categories.

<QUERY>
${query}
</QUERY>

<ARCHIVE_ENTRIES>
${Object.entries(categories).map(([categoryName, content]) => `
<ARCHIVE_ENTRY categoryName="${categoryName}">
${content}
</ARCHIVE_ENTRY>
`).join('\n')}
</ARCHIVE_ENTRIES>

You should return an <ANSWER> tag containing the final answer to the question, e.g. <ANSWER>final answer in here</ANSWER>. It is OK if you only have a partial answer, just answer the parts that you have information about. Don't make anything up.
`.trim();
    }


    async getUpdateInSingleCategoryPrompt({
                                              categoryName,
                                              previousCategoryContent,
                                              summary,
                                              information,
                                              reason
                                          }: IGetUpdateInSingleCategoryPromptOptions) {
        return `
${await this.#getSystemPrompt()}
Your current task is to update a single category with new information. You have to decide which information (if any) is relevant to this category, and which information to discard. If there is relevant information, you can merge the new information with the existing content, or replace it entirely as you choose.

This category is called "${categoryName}". 

${ifTruthy(summary, `
Here is the summary of all categories in memory:
<SUMMARY>
${summary}
</SUMMARY>

Use this summary to help decide whether the information is relevant to this category or not. We want to avoid cluttering categories with information that is not relevant to them - categories should stay somewhat focused, and we don't want duplicate information across categories.
`)}

Here is the information that you are given to update the category with:
<INFORMATION>
${information}
</INFORMATION>

This category was chosen for the following reason. Use this reason to help you determine what parts of the information, if any, are relevant to the category:
<REASON>
${reason}
</REASON>

${previousCategoryContent ? `Here is the previous version of this category's content: <PREVIOUS_CATEGORY_CONTENT>${previousCategoryContent}</PREVIOUS_CATEGORY_CONTENT>` : 'This is a new category with no existing content. You are creating the entire thing from scratch.'}

If the information is not relevant to this category, return a <SKIP> tag so that we don't update the category, e.g. <SKIP>not relevant</SKIP>.
Otherwise, return a <CATEGORY_CONTENT> tag containing the new category content, e.g. <CATEGORY_CONTENT>new category content in here</CATEGORY_CONTENT>, and a <DIFF_SUMMARY> tag containing a summary of the changes made, e.g. <DIFF_SUMMARY>summary of changes in here</DIFF_SUMMARY>
`.trim();
    }

    async getUpdateSummaryPrompt(previousSummary: string, information: Record<string /*categoryName*/, string /*changeInfo*/>) {
        return `
${await this.#getSystemPrompt()}
Your task is to update the summary based on new information. Some category/categories have updated, and their new descriptions will be given. You can merge descriptions or replace entirely as you choose.
${SUMMARY_DESCRIPTION_EXPLANATION}
Return an UPDATED_SUMMARY element with file contents inside, e.g. <UPDATED_SUMMARY>updated file contents in here</UPDATED_SUMMARY>
The summary should be in Markdown format, with each category in its own h3/### section whose title is the full category name.

<PREVIOUS_SUMMARY>
${describeSummary(previousSummary)}
</PREVIOUS_SUMMARY>

<CATEGORY_UPDATES>
${Object.entries(information).map(([categoryName, changeInfo]) => `
<CATEGORY_UPDATE category="${categoryName}">
${changeInfo}
</CATEGORY_UPDATE>
`)}
</CATEGORY_UPDATES>
`.trim();
    }
}