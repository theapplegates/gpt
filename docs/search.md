# Search with Orama

Search runs entirely in the visitor's browser using the open-source `@orama/orama` engine. Netlify serves the static site and generated indexes. Your laptop can be off; no Typesense process, paid search plan, API key, database server, or Netlify Function is needed.

## Local use

- Run `pnpm dev` to search current content during editing. Orama builds an in-memory index from the development-only JSON endpoint. Refresh after changing content.
- Run `pnpm build && pnpm preview` to test the production search index.
- The build extracts rendered public content into `dist/search/<locale>.json`. Only the current language's index is downloaded, on the first search or autocomplete request.

## Netlify

Use build command `pnpm build` and publish directory `dist`. Keep the repository's pinned pnpm version and use Node 24 or another version satisfying `package.json`. No search-related environment variables are required. A normal site deployment also updates the search index.

For a site deployed under a subdirectory, the configured site base path is included in search index requests and result links.

## Search behavior

- Results update 180 ms after typing stops, with protection against stale responses and support for IME composition.
- Prefix matching supports incomplete words. Words of at least four characters allow one typo; queries whose words are all at least eight characters allow two. Short terms and Chinese character searches use exact prefixes to avoid broad accidental matches.
- Article suggestions appear as you type, including after `@`. Use the arrow keys to select a suggestion, then Enter or Tab to complete it. Click a suggestion to complete it, or press Escape to dismiss the menu.
- `/` commands and their argument suggestions remain available.
- Matching text is highlighted in titles, descriptions, suggestions, and paragraph snippets, including corrected words from fuzzy matches. Highlights are rendered as text nodes and `<mark>` elements.
- Article, title/description, body, and whole-site scopes remain available. Body snippets link to the matching paragraph.
- Chinese searches use character tokens plus verification of contiguous query text. The same tokenizer runs during builds and browser queries.
- Draft, future, unlisted, hidden, and bundled attachment content is excluded according to the site's existing public-content rules. Languages never fall back to another language's index.

Indexes contain the public searchable text and are downloaded by the browser. For a substantially larger content collection, review index size and browser memory usage before deciding whether to move search to a hosted service.
