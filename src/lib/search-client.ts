import type { SearchScope } from './search';
import type { SearchSection } from './search-context';
import { Highlight } from '@orama/highlight';

export type SearchResult = {
  title: string;
  description: string;
  url: string;
  sections: SearchSection[];
  matchedTerms: string[];
};

/** Load the locale index only on demand and share it between results and autocomplete. */
export function oramaSearch(
  indexUrl: string,
  pageSignal: AbortSignal,
  dev = false,
  request: typeof fetch = fetch,
) {
  let pending:
    | Promise<{
        engine: typeof import('../../scripts/lib/orama-search.mjs');
        database: ReturnType<
          typeof import('../../scripts/lib/orama-search.mjs').createSearchDatabase
        >;
      }>
    | undefined;
  return async (
    query: string,
    scope: SearchScope,
    options: { signal?: AbortSignal; limit?: number } = {},
  ): Promise<SearchResult[]> => {
    pageSignal.throwIfAborted();
    options.signal?.throwIfAborted();
    pending ??= Promise.all([
      import('../../scripts/lib/orama-search.mjs'),
      request(indexUrl, { signal: pageSignal }).then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      }),
    ])
      .then(([engine, data]) => ({
        engine,
        database: engine.restoreSearchDatabase(
          data === null
            ? engine.buildSearchDatabase([])
            : dev
              ? engine.buildSearchDatabase(data)
              : data,
        ),
      }))
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    const { engine, database } = await pending;
    pageSignal.throwIfAborted();
    options.signal?.throwIfAborted();
    return engine.querySearchDatabase(
      database,
      query,
      scope,
      options.limit ?? 30,
    ) as unknown as SearchResult[];
  };
}

/** Build marks from text nodes; content and search responses never become HTML. */
export function highlightText(
  element: HTMLElement,
  text: string,
  terms: string[],
) {
  const words = [...new Set(terms.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!words.length) {
    element.textContent = text;
    return;
  }
  const highlighter = new Highlight();
  const positions = highlighter.highlight(text, words.join(' ')).positions;
  let offset = 0;
  for (const { start, end } of positions) {
    element.append(document.createTextNode(text.slice(offset, start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end + 1);
    element.append(mark);
    offset = end + 1;
  }
  element.append(document.createTextNode(text.slice(offset)));
}
