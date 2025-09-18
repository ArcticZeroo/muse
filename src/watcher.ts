import path from 'node:path';
import { MEMORY_DIRECTORY, SUMMARY_FILE_PATH, VERSIONS_FILE_PATH } from './args.js';
import { FILE_SYSTEM_EVENTS } from './events.js';
import chokidar from 'chokidar';

export const watchForChanges = async () => {
	const watcher = chokidar.watch(MEMORY_DIRECTORY, {
		persistent: false
	});

	watcher.on('all', (_eventType, filename) => {
		if (path.resolve(filename) === SUMMARY_FILE_PATH) {
			// We probably don't care about changes to the summary file, they'll just get overwritten
			// todo: maybe we should still try to prevent users from editing it directly?
			return;
		}

		if (path.resolve(filename) === VERSIONS_FILE_PATH) {
			FILE_SYSTEM_EVENTS.emit('versionsDirty');
			return;
		}

		if (path.extname(filename) !== '.md') {
			return;
		}

		// Added, removed, changed all fall into the same bucket of "dirty"
		FILE_SYSTEM_EVENTS.emit('categoryDirty', filename);
	})
}