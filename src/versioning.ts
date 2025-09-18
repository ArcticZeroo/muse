import { jsonc } from 'jsonc';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import z from 'zod';
import { SUMMARY_FILE_PATH, VERSIONS_FILE_PATH } from './args.js';
import { USER_CATEGORY_NAME } from './constants/files.js';
import { Debouncer } from './debouncer.js';
import { FILE_SYSTEM_EVENTS, MEMORY_EVENTS } from './events.js';
import { serializeSummaryFromVersions, summarizeCategory } from './summary.js';
import { getCategoryFilePath, getCategoryNameFromFilePath } from './util/category.js';
import { LockedResource } from './util/lock.js';
import { logError, logInfo } from './util/mcp.js';
import { findAllMemoryNodes } from './util/filesystem.js';
import { MaybePromise } from './models/async.js';

const VERSIONS_FILE_HEADER = `
// This file is used to generate summary.md. You can edit the descriptions in here if you would like to update summary.md. 
// This file and summary.md will be automatically updated as you change/add/remove memory categories.
`.trim()

const VERSION_ENTRY_SCHEMA = z.object({
	contentHash: z.string(),
	description: z.string(),
});

export type VersionEntry = z.infer<typeof VERSION_ENTRY_SCHEMA>;

const VERSION_FILE_SCHEMA = z.record(
	VERSION_ENTRY_SCHEMA
);

export type VersionRecord = z.infer<typeof VERSION_FILE_SCHEMA>;

export type VersionMap = Map<string /*categoryName*/, VersionEntry>;

const isSameVersionMap = (a: VersionMap, b: VersionMap) => {
	if (a.size !== b.size) {
		return false;
	}

	for (const [key, valueA] of a) {
		if (!b.has(key)) {
			return false;
		}

		const valueB = b.get(key)!;
		if (valueA.contentHash !== valueB.contentHash || valueA.description !== valueB.description) {
			return false;
		}
	}

	return true;
}

const useVersionCache = (() => {
	const cache = new LockedResource(new Map<string /*categoryName*/, VersionEntry>());

	return async (work: (resource: VersionMap) => MaybePromise<void>) => {
		await cache.use(async (resource) => {
			const beforeWork = new Map();
			for (const [key, value] of resource) {
				beforeWork.set(key, { ...value });
			}

			await work(resource);

			ensureUserCategory(resource);

			if (!isSameVersionMap(beforeWork, resource)) {
				await updateSummaryFile(resource);
			}
		});
	};
})();

const CATEGORY_DEBOUNCER = new Debouncer(250 /*settlingTimeMs*/);
const FILESYSTEM_DIRTY_CATEGORY_NAMES = new Set<string>();

const getVersionsFromDisk = async (): Promise<VersionRecord> => {
	if (!fsSync.existsSync(VERSIONS_FILE_PATH)) {
		logInfo('Versions file does not exist yet');
		return {};
	}

	const fileContents = await fs.readFile(VERSIONS_FILE_PATH, 'utf-8');
	try {
		const result = jsonc.parse(fileContents);
		return  VERSION_FILE_SCHEMA.parse(result);
	} catch (err) {
		logError(`Failed to parse versions file, returning empty object: ${err}`);
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
	await useVersionCache(async (versions) => {
		const versionsFromDisk = await getVersionsFromDisk();
		versions.clear();
		for (const [categoryName, entry] of Object.entries(versionsFromDisk)) {
			versions.set(categoryName, entry);
		}
	});
}

const hashContent = (content: string) => {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

const updateDirtyCategory = async (versions: Map<string, VersionEntry>, categoryName: string) => {
	const filepath = getCategoryFilePath(categoryName);

	if (!fsSync.existsSync(filepath)) {
		logInfo(`Category file for "${categoryName}" no longer exists, removing from versions`);
		versions.delete(categoryName);
		return;
	}

	const fileContents = await fs.readFile(filepath, 'utf-8');
	const contentHash = hashContent(fileContents);
	const existingEntry = versions.get(categoryName);
	if (existingEntry?.contentHash !== contentHash) {
		logInfo(`Category "${categoryName}" has changed, updating description`);
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

	await useVersionCache(async versions => {
		for (const dirtyCategoryName of dirtyNames) {
			await updateDirtyCategory(versions, dirtyCategoryName);
		}
	});
}

const updateDirtyCategories = () => {
	updateDirtyCategoriesAsync()
		.catch(err => console.error('Failed to update dirty categories:', err));
}

const updateSummaryFile = async (versions: VersionMap) => {
	logInfo('Updating summary file after versions map change');

	const jsonContents = JSON.stringify(Object.fromEntries(versions), null, '\t');
	await Promise.all([
		fs.writeFile(VERSIONS_FILE_PATH, `${VERSIONS_FILE_HEADER}\n${jsonContents}`, 'utf-8'),
		fs.writeFile(SUMMARY_FILE_PATH, serializeSummaryFromVersions(versions), 'utf-8')
	]);
}

const markAllNodesDirty = async () => {
	for await (const node of findAllMemoryNodes()) {
		FILE_SYSTEM_EVENTS.emit('categoryDirty', node.filePath);
	}
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
});

MEMORY_EVENTS.on('categoryDirty', ({ name, description, content }) => {
	logInfo(`Category "${name}" marked dirty by memory system`);

	const hash = hashContent(content);
	useVersionCache((versions) => {
		versions.set(name, {
			contentHash: hash,
			description
		});
	}).catch(err => console.error('Failed to update summary after category is marked dirty:', err));
});

export const readVersions = async (): Promise<VersionMap> => {
	return new Promise((resolve, reject) => {
		useVersionCache(versions => {
			resolve(new Map(versions));
		}).catch(reject);
	});
}

export const startVersioningWatcher = async () => {
	await updateVersionsFromDiskAsync();
	await markAllNodesDirty();
}
