export type Disposable = { dispose(): void };

type CacheEntry<T> = { readonly value: T; references: number };

export class AssetCache<T extends Disposable> {
  readonly #entries = new Map<string, CacheEntry<T>>();

  acquire(key: string, factory: () => T): T {
    const cached = this.#entries.get(key);
    if (cached) {
      cached.references += 1;
      return cached.value;
    }
    const value = factory();
    this.#entries.set(key, { value, references: 1 });
    return value;
  }

  release(key: string): void {
    const cached = this.#entries.get(key);
    if (!cached) return;
    cached.references -= 1;
    if (cached.references <= 0) {
      cached.value.dispose();
      this.#entries.delete(key);
    }
  }

  clear(): void {
    for (const cached of this.#entries.values()) cached.value.dispose();
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
