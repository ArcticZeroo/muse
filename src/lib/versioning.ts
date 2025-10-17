import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import z from 'zod';
import { USER_CATEGORY_NAME } from './constants/files.js';
import { Debouncer } from './debouncer.js';
import { ICategoryDirtyEvent } from './events.js';
import { retrieveCategoryDescriptionAsync, serializeSummaryFromVersions } from './summary.js';
import { getCategoryFilePath, getCategoryNameFromFilePath, isCategoryMissing } from './util/category.js';
import { LockedResource } from './util/lock.js';
import { MaybePromise } from './models/async.js';
import path from 'node:path';
import { buildCategoryTree, serializeCategoryTree } from './util/tree.js';
import chokidar, { FSWatcher } from 'chokidar';
import { MemorySession } from './session.js';
import { MERGE_CONFLICT_MARKER_REGEX } from './constants/regex.js';

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

const hashContent = (content: string) => {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export class VersionManager {
    readonly #session: MemorySession;
    readonly #useVersionCache = this.#getUseVersionCacheCallback();
    readonly #categoryDebouncer = new Debouncer(250 /*settlingTimeMs*/);
    readonly #fileSystemDirtyCategoryNames = new Set<string>();
    #watcher: FSWatcher | undefined = undefined;

    constructor(session: MemorySession) {
        this.#session = session;
    }

    async initialize() {
        await this.#updateVersionsFromDiskAsync(true /*shouldLogLoad*/);
        this.#startWatcher();
        this.#listenToEvents();
    }

    #getUseVersionCacheCallback() {
        const cache = new LockedResource(new Map<string /*categoryName*/, VersionEntry>());

        return async (work: (resource: VersionMap) => MaybePromise<void>) => {
            const lockRequestStartTime = performance.now();

            await cache.use(async (resource) => {
                if (this.#session.isClosed) {
                    this.#session.logger.warn('Session is closed, skipping version cache work');
                    return;
                }

                const elapsedTime = performance.now() - lockRequestStartTime;
                if (elapsedTime > 1000) {
                    this.#session.logger.warn(`Getting version cache lock took ${elapsedTime.toFixed(2)}ms`);
                }

                const beforeWork = new Map();
                for (const [key, value] of resource) {
                    beforeWork.set(key, { ...value });
                }

                await work(resource);

                ensureCategories(resource);

                if (!isSameVersionMap(beforeWork, resource)) {
                    await this.#updateSummaryFile(resource);
                }
            });
        };
    };

    #startWatcher() {
        if (this.#watcher) {
            this.#session.logger.warn('Watcher already exists, closing it before starting a new one');
            this.#watcher.close()
                .catch(err => this.#session.logger.error(`Failed to close existing watcher: ${err}`));
        }

        this.#watcher = chokidar.watch(this.#session.config.memoryDirectory, {
            persistent: false
        });

        this.#watcher.on('all', (_eventType, filename) => {
            if (path.resolve(filename) === this.#session.config.summaryFilePath) {
                // We probably don't care about changes to the summary file, they'll just get overwritten
                // todo: maybe we should still try to prevent users from editing it directly?
                return;
            }

            if (path.resolve(filename) === this.#session.config.versionsFilePath) {
                this.#session.fileSystemEvents.emit('versionsDirty');
                return;
            }

            if (path.extname(filename) !== '.md') {
                return;
            }

            // Added, removed, changed all fall into the same bucket of "dirty"
            this.#session.fileSystemEvents.emit('categoryDirty', filename);
        });

        this.#watcher.on('error', (err) => {
            this.#session.logger.error(`Watcher error: ${err}`);
            this.#watcher?.close()
                ?.then(() => this.#session.logger.info('Restarting watcher after error'))
                ?.catch(err => this.#session.logger.error(`Failed to close watcher: ${err}`))
                ?.finally(() => this.#startWatcher());
        });
    }

    async #onCategoryDirty({ name, content }: ICategoryDirtyEvent) {
        this.#session.logger.info(`Category "${name}" marked dirty by memory system`);

        const hash = hashContent(content);
        const description = await retrieveCategoryDescriptionAsync(this.#session, name, content);

        const filepath = getCategoryFilePath(this.#session.config, name);

        await this.#useVersionCache(async (versions) => {
            versions.set(name, {
                contentHash: hash,
                description
            });

            await fs.mkdir(path.dirname(filepath), { recursive: true });
            await fs.writeFile(filepath, content, 'utf-8');
        });
    }

    async #updateVersionsFromDiskAsync(shouldLogLoad: boolean = false) {
        await this.#useVersionCache(async (versions) => {
            const versionsFromDisk = await this.#getVersionsFromDisk();

            if (versionsFromDisk === 'has-merge-conflict-marker') {
                this.#session.logger.warn('Skipping versions load due to merge conflict marker in versions file');
                return;
            }

            versions.clear();
            for (const [categoryName, entry] of Object.entries(versionsFromDisk)) {
                if (isCategoryMissing(this.#session.config, categoryName)) {
                    this.#session.logger.info(`Category file for "${categoryName}" no longer exists, removing from versions`);
                    continue;
                }

                versions.set(categoryName, entry);
            }

            if (shouldLogLoad && versions.size > 0) {
                this.#session.logger.info(`Loaded ${versions.size} categories from disk\n${serializeCategoryTree(buildCategoryTree(Object.keys(versionsFromDisk)))}`);
            }
        });
    }

    async #getVersionsFromDisk(): Promise<VersionRecord | 'has-merge-conflict-marker'> {
        if (!fsSync.existsSync(this.#session.config.versionsFilePath)) {
            this.#session.logger.info('Versions file does not exist yet');
            return {};
        }

        const fileContents = await fs.readFile(this.#session.config.versionsFilePath, 'utf-8');

        if (MERGE_CONFLICT_MARKER_REGEX.test(fileContents)) {
            return 'has-merge-conflict-marker';
        }

        const contentsWithoutComments = fileContents.replace(/^\s*\/\/.*$/gm, '').trim();

        try {
            const result = JSON.parse(contentsWithoutComments);
            return VERSION_FILE_SCHEMA.parse(result);
        } catch (err) {
            this.#session.logger.error(`Failed to parse versions file, returning empty object: ${err}`);
            return {};
        }
    }

    async #updateDirtyCategoriesAsync(){
        if (this.#session.isClosed) {
            return;
        }

        if (this.#fileSystemDirtyCategoryNames.size === 0) {
            return;
        }

        if (this.#fileSystemDirtyCategoryNames.size > 1) {
            this.#session.logger.info(`Updating ${this.#fileSystemDirtyCategoryNames.size} dirty categories from disk`);
        }

        const dirtyNames = Array.from(this.#fileSystemDirtyCategoryNames);

        await this.#useVersionCache(async versions => {
            await Promise.all(dirtyNames.map(async (dirtyCategoryName) => {
                await this.#updateDirtyCategory(versions, dirtyCategoryName);
                this.#fileSystemDirtyCategoryNames.delete(dirtyCategoryName);
            }));
        });
    }

    #updateDirtyCategories() {
        this.#updateDirtyCategoriesAsync()
            .catch(err => console.error('Failed to update dirty categories:', err));
    }

    async #updateSummaryFile(versions: VersionMap) {
        this.#session.logger.info(`Updating summary file after versions map change`);

        const jsonContents = JSON.stringify(Object.fromEntries(versions), null, '\t');
        await Promise.all([
            fs.writeFile(this.#session.config.versionsFilePath, `${VERSIONS_FILE_HEADER}\n${jsonContents}`, 'utf-8'),
            fs.writeFile(this.#session.config.summaryFilePath, serializeSummaryFromVersions(versions), 'utf-8')
        ]);
    }

    async #updateDirtyCategory(versions: Map<string, VersionEntry>, categoryName: string) {
        const filepath = getCategoryFilePath(this.#session.config, categoryName);

        if (isCategoryMissing(this.#session.config, categoryName)) {
            this.#session.logger.info(`Category file for "${categoryName}" no longer exists, removing from versions`);
            versions.delete(categoryName);
            return;
        }

        const fileContents = await fs.readFile(filepath, 'utf-8');
        const contentHash = hashContent(fileContents);
        const existingEntry = versions.get(categoryName);
        if (existingEntry?.contentHash !== contentHash) {
            this.#session.logger.info(`Category "${categoryName}" has changed, updating description`);
            versions.set(categoryName, {
                contentHash,
                description: await retrieveCategoryDescriptionAsync(this.#session, categoryName, fileContents)
            });
        }
    }

    async readVersions(): Promise<VersionMap> {
        return new Promise((resolve, reject) => {
            this.#useVersionCache(versions => {
                resolve(new Map(versions));
            }).catch(reject);
        });
    }

    #listenToEvents() {
        this.#session.fileSystemEvents.on('categoryDirty', (filename) => {
            if (this.#session.isClosed) {
                return;
            }

            const categoryName = getCategoryNameFromFilePath(this.#session.config, filename);
            this.#fileSystemDirtyCategoryNames.add(categoryName);
            this.#categoryDebouncer.trigger(() => this.#updateDirtyCategories());
        });

        this.#session.fileSystemEvents.on('versionsDirty', () => {
            if (this.#session.isClosed) {
                return;
            }

            // If we were about to update dirty categories, wait until we've updated versions from disk
            this.#categoryDebouncer.poke();

            this.#updateVersionsFromDiskAsync()
                .catch(err => console.error('Could not update versions from disk:', err));
        });

        this.#session.memoryEvents.on('categoryDirty', (event) => {
            if (this.#session.isClosed) {
                return;
            }

            this.#onCategoryDirty(event)
                .catch(err => this.#session.logger.error(`Failed to handle category dirty event for "${event.name}": ${err}`));
        });

        this.#session.memoryEvents.on('permissionDenied', () => {
            this.#watcher?.close()
                ?.catch(err => this.#session.logger.error(`Failed to close watcher on permission denied: ${err}`));
        });
    }
}