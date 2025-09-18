import path from 'node:path';
import { MEMORY_DIRECTORY } from './args.js';
import { VERSIONS_FILE_NAME } from './constants/files.js';
import { FILE_SYSTEM_EVENTS } from './events.js';
import { logInfo } from './util/mcp.js';
import chokidar from 'chokidar';

export const watchForChanges = async () => {
	logInfo('Watching for changes...');

	const watcher = chokidar.watch(MEMORY_DIRECTORY, {
		ignored: (file, stats) => stats?.isFile() === true && path.basename(file) !== '.gitignore',
		persistent: false
	});

	watcher.on('all', (eventType, filename) => {
		logInfo(`File system event: ${eventType} on ${filename || '<unknown file>'}`);

		if (!filename) {
			FILE_SYSTEM_EVENTS.emit('unknownFileChanged', eventType);
			return;
		}

		if (filename === VERSIONS_FILE_NAME) {
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