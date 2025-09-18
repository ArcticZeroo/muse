import { getCategoryDescriptionPrompt } from './constants/prompts.js';
import { retrieveSampledMessage } from './util/mcp.js';
import { readVersions, VersionEntry } from './versioning.js';
import { DESCRIPTION_TAG } from './constants/regex.js';

export const serializeSummaryFromVersions = (versions: Map<string /*categoryName*/, VersionEntry>): string => {
	const entriesInOrder = Array.from(versions.entries())
		// TS won't let me destructure in the parameters of the filter function for some reason
		.sort(([a], [b]) => a.localeCompare(b));
	return entriesInOrder.flatMap(([key, { description }]) => {
		return [
			`### ${key}`,
			`${description}`
		];
	}).join('\n');
}

export const getSummary = async (): Promise<string> => {
	return serializeSummaryFromVersions(await readVersions());
}

export const retrieveCategoryDescriptionAsync = async (categoryName: string, content: string): Promise<string> => {
	const prompt = getCategoryDescriptionPrompt(categoryName, content);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 2000
	});

	const description = DESCRIPTION_TAG.matchOne(response);
	if (!description) {
		throw new Error('Unable to generate description.');
	}

	return description;
};