import fs from 'node:fs/promises';
import path from 'node:path';
import { jsonc } from 'jsonc';
import { VERSIONS_FILE_NAME } from './constants/files.js';
import z from 'zod';
import { CATEGORY_NAME_REGEX } from './memory.js';
import { LockedMap } from './util/map.js';
import { Lock, LockedResource } from './util/lock.js';
import { MEMORY_DIRECTORY, SUMMARY_FILE_PATH } from './args.js';
import { Debouncer } from './debouncer.js';
import { FILE_SYSTEM_EVENTS, MEMORY_EVENTS } from './events.js';
import { getCategoryFilePath, getCategoryNameFromFilePath } from './util/category.js';
import crypto from 'node:crypto';

const versionEntrySchema = z.object({
	contentHash: z.string().nonempty(),
	description: z.string().nonempty(),
});

type VersionEntry = z.infer<typeof versionEntrySchema>;

const versionFileSchema = z.record(
	z.string().nonempty().regex(CATEGORY_NAME_REGEX).describe('Category name'),
	z.object({
		contentHash: z.string().nonempty(),
		description: z.string().nonempty(),
	})
);

type VersionRecord = z.infer<typeof  versionFileSchema>;

const getVersionsFromDisk = async (): Promise<VersionRecord> => {
	const fileContents = await fs.readFile(VERSIONS_FILE_NAME, 'utf-8');
	try {
		const result = jsonc.parse(fileContents);
		return  versionFileSchema.parse(result);
	} catch (err) {
		console.error('Failed to parse versions file, returning empty object:', err);
		return {};
	}
}

const VERSIONS_CACHE = new LockedResource(new Map<string /*categoryName*/, VersionEntry>());

const versionDebouncer = new Debouncer(1000 /*settlingTimeMs*/);
const categoryDebouncersByName = new Map<string /*categoryName*/, Debouncer>();

const updateVersionsFromDiskAsync = async () => {
	await VERSIONS_CACHE.use(async (versions) => {
		const versionsFromDisk = await getVersionsFromDisk();
		versions.clear();
		for (const [categoryName, entry] of Object.entries(versionsFromDisk)) {
			versions.set(categoryName, entry);
		}
	});
}

await updateVersionsFromDiskAsync();

const hashContent = (content: string) => {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

FILE_SYSTEM_EVENTS.on('versionsDirty', () => {
	versionDebouncer.trigger(() => {
		updateVersionsFromDiskAsync()
			.catch(err => console.error('Could not update versions from disk:', err));
	});
});

FILE_SYSTEM_EVENTS.on('categoryDirty', (filename) => {
	const categoryName = getCategoryNameFromFilePath(filename);
	if (!categoryDebouncersByName.has(categoryName)) {
		categoryDebouncersByName.set(categoryName, new Debouncer(1000 /*settlingTimeMs*/));
	}

	const debouncer = categoryDebouncersByName.get(categoryName)!;
	debouncer.trigger(() => {
		// todo: check the hash against
	});
});

const updateSummaryFile = async (versions: Map<string, VersionEntry>) => {
	const entriesInOrder = Array.from(versions.entries()).sort(([a], [b]) => a.localeCompare(b));
	const lines = entriesInOrder.flatMap(([key, { description }]) => {
		return [
			`### ${key}`,
			`${description}`
		];
	}).join('\n');
	await fs.writeFile(SUMMARY_FILE_PATH, lines, 'utf-8');
}

MEMORY_EVENTS.on('categoryDirty', ({ name, description, content }) => {
	const hash = hashContent(content);
	VERSIONS_CACHE.use((versions) => {
		versions.set(name, {
			contentHash: hash,
			description
		});
		return updateSummaryFile(versions);
	}).catch(err => console.error('Failed to update summary after category is marked dirty:', err));
});