import { Lock } from './lock.js';
import { MaybePromise } from '../models/async.js';

export class LockedMap<K, V> {
    readonly #locks: Map<K, Lock> = new Map();
    readonly #values: Map<K, V> = new Map();

	constructor(initialState?: Iterable<[K, V]>) {
		if (initialState) {
			for (const [key, value] of initialState) {
				this.#locks.set(key, new Lock());
				this.#values.set(key, value);
			}
		}
	}

    get size(): number {
        return this.#locks.size;
    }

    entries()  {
        return this.#values.entries();
    }

    async has(key: K): Promise<boolean> {
        if (!this.#locks.has(key)) {
            return false;
        }

        // There might be a pending delete for the key,
        // so try to acquire it and then check again.
        const lock = this.#locks.get(key)!;
        return lock.acquire(() => this.#locks.has(key));
    }

    async update<TReturn extends V | undefined>(key: K, callback: (value: V | undefined) => MaybePromise<TReturn>): Promise<TReturn> {
        if (!this.#locks.has(key)) {
            this.#locks.set(key, new Lock());
        }

        const lock = this.#locks.get(key)!;

        return lock.acquire(async () => {
            const value = this.#values.get(key);
            const newValue = await callback(value);

            if (newValue === undefined) {
                this.#locks.delete(key);
                this.#values.delete(key);
            } else {
                this.#values.set(key, newValue);
            }

            return newValue;
        });
    }

    async delete(key: K) {
        const lock = this.#locks.get(key);
        if (!lock) {
            return;
        }

        return lock.acquire(() => {
            this.#locks.delete(key);
            this.#values.delete(key);
        });
    }

	async #updateEntireMap(work: (key: K) => MaybePromise<void>): Promise<void> {
		const acquirePromises: Array<Promise<void>> = [];
		const workPromises: Array<Promise<void>> = [];

		for (const [key, lock] of this.#locks.entries()) {
			acquirePromises.push(new Promise(resolve => {
				workPromises.push(lock.acquire(async () => {
					resolve();
					await Promise.all(acquirePromises);
					await work(key);
				}));
			}));
		}

		await Promise.all(workPromises);
	}

	async clear() {
		return this.#updateEntireMap(key => {
			this.#locks.delete(key);
			this.#values.delete(key);
		});
	}

	async replaceAll(newState: Iterable<[K, V]>) {
		const newMap = new Map<K, V>(newState);

		for (const [key, value] of newMap) {
			if (!this.#locks.has(key)) {
				this.#locks.set(key, new Lock());
				this.#values.set(key, value);
			}
		}

		return this.#updateEntireMap(key => {
			if (!newMap.has(key)) {
				this.#locks.delete(key);
				this.#values.delete(key);
			} else {
				this.#values.set(key, newMap.get(key)!);
			}
		});
	}
}