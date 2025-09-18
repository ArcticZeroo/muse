import fs from 'node:fs/promises';
import path from 'node:path';
import { MEMORY_DIRECTORY, SUMMARY_FILE_PATH } from '../args.js';
import { IMemoryNode } from '../models/memory.js';

export async function* findAllMemoryNodes(): AsyncGenerator<IMemoryNode> {
	async function* readNode(nodePath: string, parents: string[] = []): AsyncGenerator<IMemoryNode> {
		const files = await fs.readdir(nodePath, { withFileTypes: true });

		for (const node of files) {
			if (node.isDirectory()) {
				yield* readNode(path.join(nodePath, node.name), [...parents, node.name]);
				continue;
			}

			if (!node.isFile()) {
				continue;
			}

			if (!node.name.endsWith('.md')) {
				continue;
			}

			const filePath = path.join(nodePath, node.name);
			if (path.resolve(filePath) === SUMMARY_FILE_PATH) {
				continue;
			}

			const baseName = path.basename(node.name, '.md');
			const categoryName = `${parents.join('/')}/${baseName}`;

			yield { categoryName, filePath };
		}
	}

	yield* readNode(MEMORY_DIRECTORY, []);
}