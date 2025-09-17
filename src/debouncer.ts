export class Debouncer {
	readonly #settlingTimeMs: number;
	#timeoutHandle: ReturnType<setTimeout> | null = null;

	constructor(settlingTimeMs: number) {
		this.#settlingTimeMs = settlingTimeMs;
	}

	trigger(callback: () => void) {
		clearTimeout(this.#timeoutHandle);

		this.#timeoutHandle = setTimeout(() => {
			this.#timeoutHandle = null;
			callback();
		}, this.#settlingTimeMs);
	}
}