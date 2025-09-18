import { getCategoryDescriptionPrompt } from './constants/prompts.js';
import { retrieveSampledMessage } from './util/mcp.js';
import { readVersions, VersionEntry } from './versioning.js';

const DESCRIPTION_REGEX = /<DESCRIPTION>(?<description>[\s\S]*?)<\/DESCRIPTION>/;

export const serializeSummaryFromVersions = (versions: Map<string /*categoryName*/, VersionEntry>): string => {
	const entriesInOrder = Object.entries(versions)
		// TS won't let me destructure in the parameters of the filter function for some reason
		.sort((a, b) => a[0].localeCompare(b[0]));
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

export const summarizeCategory = async (categoryName: string, content: string): Promise<string> => {
	const prompt = getCategoryDescriptionPrompt(categoryName, content);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 2000
	});

	const description = response.match(DESCRIPTION_REGEX)?.groups?.description;
	if (!description) {
		throw new Error('Unable to generate description.');
	}

	return description.trim();
};