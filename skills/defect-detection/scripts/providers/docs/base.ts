export interface DocProvider {
  fetch(url_or_id: string): Record<string, any>;
}
