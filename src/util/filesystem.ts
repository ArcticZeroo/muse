import fs from 'node:fs/promises';
import path from 'node:path';
import { IMemoryNode } from '../models/memory.js';
import { IMemoryConfig } from '../models/session.js';

export async function* findAllMemoryNodes(config: IMemoryConfig): AsyncGenerator<IMemoryNode> {
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
			if (path.resolve(filePath) === config.summaryFilePath) {
				continue;
			}

			const baseName = path.basename(node.name, '.md');
			const categoryName = `${parents.join('/')}/${baseName}`;

			yield { categoryName, filePath };
		}
	}

	yield* readNode(config.memoryDirectory, []);
}