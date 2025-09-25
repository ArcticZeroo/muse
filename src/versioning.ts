import { jsonc } from 'jsonc';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import z from 'zod';
import { SUMMARY_FILE_PATH, VERSIONS_FILE_PATH } from './args.js';
import { USER_CATEGORY_NAME } from './constants/files.js';
import { Debouncer } from './debouncer.js';
import { FILE_SYSTEM_EVENTS, ICategoryDirtyEvent, MEMORY_EVENTS } from './events.js';
import { retrieveCategoryDescriptionAsync, serializeSummaryFromVersions } from './summary.js';
import { getCategoryFilePath, getCategoryNameFromFilePath, isCategoryMissing } from './util/category.js';
import { LockedResource } from './util/lock.js';
import { logError, logInfo, logWarn } from './util/mcp.js';
import { MaybePromise } from './models/async.js';
import { watchForChanges } from './watcher.js';
import path from 'node:path';
import { buildCategoryTree, serializeCategoryTree } from './util/tree.js';
import { trackSpan } from './util/perf.js';

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
        const lockRequestStartTime = performance.now();

		await cache.use(async (resource) => {
            const elapsedTime = performance.now() - lockRequestStartTime;
            if (elapsedTime > 1000) {
                logWarn(`Getting version cache lock took ${elapsedTime.toFixed(2)}ms`);
            }

			const beforeWork = new Map();
			for (const [key, value] of resource) {
				beforeWork.set(key, { ...value });
			}

			await work(resource);

			ensureCategories(resource);

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

const ensureCategories = (versions: Map<string, VersionEntry>) => {
	if (!versions.has(USER_CATEGORY_NAME)) {
		versions.set(USER_CATEGORY_NAME, {
			contentHash: '',
			description: 'This category contains information about the user and their specific preferences.'
		});
	}

	// just in case a bug crept in...
	versions.delete('summary');
}

const updateVersionsFromDiskAsync = async (shouldLogLoad: boolean = false) => {
	await useVersionCache(async (versions) => {
		const versionsFromDisk = await getVersionsFromDisk();
		versions.clear();
		for (const [categoryName, entry] of Object.entries(versionsFromDisk)) {
			if (isCategoryMissing(categoryName)) {
				logInfo(`Category file for "${categoryName}" no longer exists, removing from versions`);
				continue;
			}

			versions.set(categoryName, entry);
		}

		if (shouldLogLoad) {
			logInfo(`Loaded ${versions.size} categories from disk\n${serializeCategoryTree(buildCategoryTree(Object.keys(versionsFromDisk)))}`);
		}
	});
}

const hashContent = (content: string) => {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

const updateDirtyCategory = async (versions: Map<string, VersionEntry>, categoryName: string) => {
	const filepath = getCategoryFilePath(categoryName);

	if (isCategoryMissing(categoryName)) {
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
			description: await retrieveCategoryDescriptionAsync(categoryName, fileContents)
		});
	}
}

const updateDirtyCategoriesAsync = async () => {
	if (FILESYSTEM_DIRTY_CATEGORY_NAMES.size === 0) {
		return;
	}

    if (FILESYSTEM_DIRTY_CATEGORY_NAMES.size > 1) {
        logInfo(`Updating ${FILESYSTEM_DIRTY_CATEGORY_NAMES.size} dirty categories from disk`);
    }

	const dirtyNames = Array.from(FILESYSTEM_DIRTY_CATEGORY_NAMES);

	await useVersionCache(async versions => {
        await Promise.all(dirtyNames.map(async (dirtyCategoryName) => {
            await updateDirtyCategory(versions, dirtyCategoryName);
            FILESYSTEM_DIRTY_CATEGORY_NAMES.delete(dirtyCategoryName);
        }));
	});
}

const updateDirtyCategories = () => {
	trackSpan('updating dirty categories', updateDirtyCategoriesAsync)
		.catch(err => console.error('Failed to update dirty categories:', err));
}

const updateSummaryFile = async (versions: VersionMap) => {
	logInfo(`Updating summary file after versions map change`);

	const jsonContents = JSON.stringify(Object.fromEntries(versions), null, '\t');
	await Promise.all([
		fs.writeFile(VERSIONS_FILE_PATH, `${VERSIONS_FILE_HEADER}\n${jsonContents}`, 'utf-8'),
		fs.writeFile(SUMMARY_FILE_PATH, serializeSummaryFromVersions(versions), 'utf-8')
	]);
}

export const readVersions = async (): Promise<VersionMap> => {
	return new Promise((resolve, reject) => {
		useVersionCache(versions => {
			resolve(new Map(versions));
		}).catch(reject);
	});
}

export const startVersioningWatcher = async () => {
	await updateVersionsFromDiskAsync(true /*shouldLogLoad*/);
	watchForChanges()
		.catch(err => logError(`Failed to watch for file changes: ${err}`));
}

const onCategoryDirty = async ({ name, content }: ICategoryDirtyEvent) => {
    logInfo(`Category "${name}" marked dirty by memory system`);

    const hash = hashContent(content);
    const description = await retrieveCategoryDescriptionAsync(name, content);

    const filepath = getCategoryFilePath(name);

    await useVersionCache(async (versions) => {
        versions.set(name, {
            contentHash: hash,
            description
        });

        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, content, 'utf-8');
    });
}

FILE_SYSTEM_EVENTS.on('categoryDirty', (filename) => {
	const categoryName = getCategoryNameFromFilePath(filename);
	FILESYSTEM_DIRTY_CATEGORY_NAMES.add(categoryName);
	CATEGORY_DEBOUNCER.trigger(updateDirtyCategories);
});

FILE_SYSTEM_EVENTS.on('versionsDirty', () => {
	// If we were about to update dirty categories, wait until we've updated versions from disk
	CATEGORY_DEBOUNCER.poke();

    trackSpan('update versions from disk', updateVersionsFromDiskAsync)
        .catch(err => console.error('Could not update versions from disk:', err));
});

MEMORY_EVENTS.on('categoryDirty', (event) => {
    trackSpan(`category dirty: ${event.name}`, () => onCategoryDirty(event))
        .catch(err => logError(`Failed to handle category dirty event for "${event.name}": ${err}`));
});