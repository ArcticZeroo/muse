import { jsonc } from 'jsonc';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import z from 'zod';
import { SUMMARY_FILE_PATH } from './args.js';
import { USER_CATEGORY_NAME, VERSIONS_FILE_NAME } from './constants/files.js';
import { Debouncer } from './debouncer.js';
import { FILE_SYSTEM_EVENTS, MEMORY_EVENTS } from './events.js';
import { summarizeCategory } from './summary.js';
import { getCategoryFilePath, getCategoryNameFromFilePath } from './util/category.js';
import { LockedResource } from './util/lock.js';
import { logInfo } from './util/mcp.js';

const VERSIONS_FILE_HEADER = `
// This file is used to generate summary.md. You can edit the descriptions in here if you would like to update summary.md. 
// This file and summary.md will be automatically updated as you change/add/remove memory categories.
`.trim()

const VERSION_ENTRY_SCHEMA = z.object({
	contentHash: z.string().nonempty(),
	description: z.string().nonempty(),
});

type VersionEntry = z.infer<typeof VERSION_ENTRY_SCHEMA>;

const VERSION_FILE_SCHEMA = z.record(
	z.object({
		contentHash: z.string().nonempty(),
		description: z.string().nonempty(),
	})
);

type VersionRecord = z.infer<typeof  VERSION_FILE_SCHEMA>;

const VERSIONS_CACHE = new LockedResource(new Map<string /*categoryName*/, VersionEntry>());

const VERSION_DEBOUNCER = new Debouncer(1000 /*settlingTimeMs*/);
const CATEGORY_DEBOUNCER = new Debouncer(1000 /*settlingTimeMs*/);
const FILESYSTEM_DIRTY_CATEGORY_NAMES = new Set<string>();


const getVersionsFromDisk = async (): Promise<VersionRecord> => {
	const fileContents = await fs.readFile(VERSIONS_FILE_NAME, 'utf-8');
	try {
		const result = jsonc.parse(fileContents);
		return  VERSION_FILE_SCHEMA.parse(result);
	} catch (err) {
		console.error('Failed to parse versions file, returning empty object:', err);
		return {};
	}
}

const ensureUserCategory = (versions: Map<string, VersionEntry>) => {
	if (!versions.has(USER_CATEGORY_NAME)) {
		versions.set(USER_CATEGORY_NAME, {
			contentHash: '',
			description: 'This category contains information about the user and their specific preferences.'
		});
	}
}

const updateVersionsFromDiskAsync = async () => {
	await VERSIONS_CACHE.use(async (versions) => {
		const versionsFromDisk = await getVersionsFromDisk();
		versions.clear();
		for (const [categoryName, entry] of Object.entries(versionsFromDisk)) {
			versions.set(categoryName, entry);
		}
		ensureUserCategory(versions);
	});
}

const hashContent = (content: string) => {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

const updateDirtyCategory = async (versions: Map<string, VersionEntry>, categoryName: string) => {
	const filepath = getCategoryFilePath(categoryName);

	if (!fsSync.existsSync(filepath)) {
		versions.delete(categoryName);
		return;
	}

	const fileContents = await fs.readFile(filepath, 'utf-8');
	const contentHash = hashContent(fileContents);
	const existingEntry = versions.get(categoryName);
	if (existingEntry?.contentHash !== contentHash) {
		versions.set(categoryName, {
			contentHash,
			description: await summarizeCategory(categoryName, fileContents)
		});
	}
}

const updateDirtyCategoriesAsync = async () => {
	if (FILESYSTEM_DIRTY_CATEGORY_NAMES.size === 0) {
		return;
	}

	const dirtyNames = Array.from(FILESYSTEM_DIRTY_CATEGORY_NAMES);
	logInfo(`Updating ${dirtyNames.length} dirty categories: ${dirtyNames.join(', ')}`);

	await VERSIONS_CACHE.use(async versions => {
		const promises: Array<Promise<void>> = [];
		for (const dirtyCategoryName of dirtyNames) {
			promises.push(updateDirtyCategory(versions, dirtyCategoryName));
		}
		await Promise.all(promises);
		VERSION_DEBOUNCER.trigger(updateSummaryFile);
	});
}

const updateDirtyCategories = () => {
	updateDirtyCategoriesAsync()
		.catch(err => console.error('Failed to update dirty categories:', err));
}

const updateSummaryFile = () => {
	logInfo('Updating summary file');

	VERSIONS_CACHE.use(async versions => {
		ensureUserCategory(versions);

		const entriesInOrder = Array.from(versions.entries())
			// TS won't let me destructure in the parameters of the filter function for some reason
			.sort((a, b) => a[0].localeCompare(b[0]));
		const lines = entriesInOrder.flatMap(([key, { description }]) => {
			return [
				`### ${key}`,
				`${description}`
			];
		}).join('\n');

		const jsonContents = JSON.stringify(Object.fromEntries(entriesInOrder), null, '\t');
		await Promise.all([
			fs.writeFile(VERSIONS_FILE_NAME, `${VERSIONS_FILE_HEADER}\n${jsonContents}`, 'utf-8'),
			fs.writeFile(SUMMARY_FILE_PATH, lines, 'utf-8')
		]);
	}).catch(err => console.error('Failed to update summary file:', err));
}

FILE_SYSTEM_EVENTS.on('categoryDirty', (filename) => {
	logInfo(`Category file changed on disk: ${filename}`);

	const categoryName = getCategoryNameFromFilePath(filename);
	FILESYSTEM_DIRTY_CATEGORY_NAMES.add(categoryName);
	CATEGORY_DEBOUNCER.trigger(updateDirtyCategories);
});

FILE_SYSTEM_EVENTS.on('versionsDirty', () => {
	logInfo('Versions file changed on disk');

	// If we were about to update dirty categories, wait until we've updated versions from disk
	CATEGORY_DEBOUNCER.poke();

	updateVersionsFromDiskAsync()
		.catch(err => console.error('Could not update versions from disk:', err));

	VERSION_DEBOUNCER.trigger(updateSummaryFile);
});

MEMORY_EVENTS.on('categoryDirty', ({ name, description, content }) => {
	logInfo(`Category "${name}" marked dirty by memory system`);

	const hash = hashContent(content);
	VERSIONS_CACHE.use((versions) => {
		versions.set(name, {
			contentHash: hash,
			description
		});

		VERSION_DEBOUNCER.trigger(updateSummaryFile);
	}).catch(err => console.error('Failed to update summary after category is marked dirty:', err));
});

await updateVersionsFromDiskAsync();
VERSION_DEBOUNCER.trigger(updateSummaryFile);
