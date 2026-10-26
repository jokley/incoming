/** Restore replaces all event data; no pre-restore identity or cache may survive. */
export class DatabaseGeneration {
  private generation: string | null = null;
  private invalidated = false;
  private readonly reload: () => void;
  constructor(reload: () => void) { this.reload = reload; }
  decorate(headers: Headers) {
    if (this.invalidated) throw new DOMException('Datenbank wurde wiederhergestellt.', 'AbortError');
    if (this.generation) headers.set('X-Database-Generation', this.generation);
  }
  observe(response: Response) {
    if (this.invalidated) throw new DOMException('Datenbank wurde wiederhergestellt.', 'AbortError');
    const generation = response.headers.get('X-Database-Generation');
    if (!generation) return;
    if (this.generation && this.generation !== generation) {
      this.invalidated = true;
      this.reload();
      throw new DOMException('Datenbank wurde wiederhergestellt. Anwendung wird neu geladen.', 'AbortError');
    }
    this.generation = generation;
  }
}
