import { create, insertMultiple, search, save, load } from '@orama/orama';
import { tokenizer } from '@orama/orama/components';
import { boundedLevenshtein } from '@orama/orama/internals';

export const searchSchema = /** @type {const} */ ({
  title: 'string',
  description: 'string',
  body: 'string',
  kind: 'enum',
});
const normalize = (text) =>
  text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const words = (text) =>
  text
    .replace(/\p{Script=Han}/gu, (char) => ` ${char} `)
    .match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];

/** Identical Unicode tokenization in Node and browsers; no CJK dictionary downloads. */
export function createSearchDatabase() {
  const component = tokenizer.createTokenizer({ stemming: false });
  component.tokenize = (text) => [...new Set(words(text).map(normalize))];
  return create({ schema: searchSchema, components: { tokenizer: component } });
}

export function buildSearchDatabase(records) {
  const database = createSearchDatabase();
  const grouped = new Map();
  for (const record of records) {
    const prior = grouped.get(record.url);
    grouped.set(
      record.url,
      prior
        ? {
            ...prior,
            body: `${prior.body} ${record.body}`,
            sections: [...(prior.sections ?? []), ...(record.sections ?? [])],
          }
        : record,
    );
  }
  insertMultiple(
    database,
    [...grouped.values()].map((record) => ({ ...record, id: record.url })),
  );
  return save(database);
}

export function restoreSearchDatabase(data) {
  const database = createSearchDatabase();
  load(database, data);
  return database;
}

export function querySearchDatabase(database, query, scope, limit = 30) {
  const tokens = words(query).map(normalize);
  if (!tokens.length) return [];
  // Short queries and CJK characters require exact prefixes; longer words allow typos.
  const shortest = Math.min(...tokens.map((token) => token.length));
  const tolerance = shortest >= 8 ? 2 : shortest >= 4 ? 1 : 0;
  const properties =
    scope === 'title'
      ? ['title', 'description']
      : scope === 'body'
        ? ['body']
        : ['title', 'description', 'body'];
  const runs = query.match(/\p{Script=Han}+/gu) ?? [];
  const matches = [];
  const batchSize = Math.max(30, limit);
  for (let offset = 0; ; offset += batchSize) {
    const result = search(database, {
      term: query,
      properties,
      tolerance,
      threshold: 0,
      boost: { title: 5, description: 2, body: 1 },
      ...(scope === 'all' ? {} : { where: { kind: { eq: 'posts' } } }),
      limit: batchSize,
      offset,
    });
    for (const hit of result.hits) {
      const document = hit.document;
      const text = properties.map((property) => document[property]).join(' ');
      // Character tokens find candidates; retain contiguous Chinese query runs.
      if (!runs.every((run) => text.includes(run))) continue;
      const matchedTerms = [
        ...new Set([
          ...runs,
          ...words(text).filter((word) => {
            if (/\p{Script=Han}/u.test(word)) return false;
            const normalized = normalize(word);
            return tokens.some(
              (token) =>
                normalized.startsWith(token) ||
                (tolerance &&
                  // The first argument is the query; reversing them makes
                  // short words such as "a" count as matches for "apples".
                  boundedLevenshtein(token, normalized, tolerance).isBounded),
            );
          }),
        ]),
      ];
      matches.push({ ...document, matchedTerms });
      if (matches.length >= limit) return matches;
    }
    if (offset + batchSize >= result.count) break;
  }
  return matches;
}
