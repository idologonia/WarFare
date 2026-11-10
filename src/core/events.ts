/** Мінімальний типізований емітер подій. */
export class Emitter<T> {
  private handlers = new Set<(e: T) => void>();
  on(h: (e: T) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(e: T): void {
    for (const h of this.handlers) h(e);
  }
}
