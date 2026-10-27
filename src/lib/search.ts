export const searchScopes = ['all', 'articles', 'title', 'body'] as const;
export type SearchScope = (typeof searchScopes)[number];
export type SearchEntry = {
  title: string;
  description: string;
  body: string;
  sections: { heading: string; id: string; text: string }[];
  url: string;
  kind: 'posts' | 'pages' | 'categories' | 'tags';
};
export function searchScope(value: string | null | undefined): SearchScope {
  return searchScopes.find((scope) => scope === value) ?? 'articles';
}
