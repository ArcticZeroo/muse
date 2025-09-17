import { MaybePromise } from '../models/async.js';

export class Lock {
	#queue: Array<() => void> = [];

	get queueLength() {
		return this.#queue.length;
	}

	#doNext() {
		const next = this.#queue[0];
		next?.();
	}

	acquire<T = void>(work: () => MaybePromise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			const callback = async () => {
				try {
					resolve(await work());
				} catch (err) {
					reject(err);
				} finally {
					this.#queue.shift();
					this.#doNext();
				}
			}

			const canImmediatelyExecute = this.#queue.length === 0;
			this.#queue.push(callback);

			if (canImmediatelyExecute) {
				this.#doNext();
			}
		});
	}
}

// This is different from a LockedMap because the LockedMap stores data for each id,
// while the MultiLock only stores a lock for each id to prevent duplicate work.
export class MultiLock {
	readonly #locksById = new Map<string, Lock>();

	async acquire<T = void>(id: string, work: () => MaybePromise<T>): Promise<T> {
		if (!this.#locksById.has(id)) {
			this.#locksById.set(id, new Lock());
		}

		const lock = this.#locksById.get(id)!;
		return lock.acquire(async () => {
			const result = await work();

			if (lock.queueLength === 0) {
				this.#locksById.delete(id);
			}

			return result;
		});
	}
}

export class LockedResource<T> {
	readonly #lock = new Lock();
	#resource: T;

	constructor(initialResource: T) {
		this.#resource = initialResource;
	}

	async use<R = void>(work: (resource: T) => MaybePromise<R>): Promise<R> {
		return this.#lock.acquire(() => work(this.#resource));
	}

	async update(work: (resource: T) => MaybePromise<T>): Promise<void> {
		await this.#lock.acquire(async () => {
			this.#resource = await work(this.#resource);
		});
	}
}