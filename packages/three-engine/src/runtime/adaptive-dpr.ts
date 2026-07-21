export type AdaptiveDprOptions = {
  readonly minDpr?: number;
  readonly maxDpr: number;
  readonly lowFps?: number;
  readonly highFps?: number;
};

export class AdaptiveDpr {
  readonly #minDpr: number;
  readonly #maxDpr: number;
  readonly #lowFps: number;
  readonly #highFps: number;
  #dpr: number;

  constructor(options: AdaptiveDprOptions) {
    this.#minDpr = options.minDpr ?? 0.75;
    this.#maxDpr = options.maxDpr;
    this.#lowFps = options.lowFps ?? 35;
    this.#highFps = options.highFps ?? 55;
    this.#dpr = options.maxDpr;
  }

  get value(): number {
    return this.#dpr;
  }

  sample(fps: number): number {
    if (fps < this.#lowFps) this.#dpr = Math.max(this.#minDpr, this.#dpr - 0.25);
    if (fps > this.#highFps) this.#dpr = Math.min(this.#maxDpr, this.#dpr + 0.1);
    this.#dpr = Number(this.#dpr.toFixed(2));
    return this.#dpr;
  }
}
