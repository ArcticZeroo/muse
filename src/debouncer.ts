import { logInfo } from './util/mcp.js';

type PromiseResolveFunction<T = void> = (result: PromiseLike<T> | T) => void;

export class Debouncer {
	readonly #settlingTimeMs: number;
	#timeoutHandle: NodeJS.Timeout | undefined = undefined;
	#nextCallback: (() => void) | undefined = undefined;
	#pendingPromise: Promise<void> = Promise.resolve();
	#pendingPromiseResolve: PromiseResolveFunction | undefined = undefined;

	constructor(settlingTimeMs: number) {
		this.#settlingTimeMs = settlingTimeMs;
	}

	#run() {
		this.#nextCallback?.();
		this.#pendingPromiseResolve?.(void 0);

		this.#nextCallback = undefined;
		this.#pendingPromiseResolve = undefined;
		this.#timeoutHandle = undefined;
	}

	#queueTimeout() {
		clearTimeout(this.#timeoutHandle);

		if (!this.#pendingPromiseResolve) {
			this.#pendingPromise = new Promise<void>((resolve) => {
				this.#pendingPromiseResolve = resolve;
			});
		}

		this.#timeoutHandle = setTimeout(
			() => {
				this.#run();
			},
			this.#settlingTimeMs
		);
	}

	async waitForPendingTrigger() {
		await this.#pendingPromise;
	}

	poke() {
		if (this.#timeoutHandle) {
			this.#queueTimeout();
		}
	}

	trigger(callback: () => void) {
		this.#nextCallback = callback;
		this.#queueTimeout();
	}
}