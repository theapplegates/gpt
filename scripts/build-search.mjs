import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchRecords } from './lib/search-records.mjs';
import { buildSearchDatabase } from './lib/orama-search.mjs';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return files.flat();
}
// HTML attachments are documents, not generated blog routes or search candidates.
const attachments = new Set(
  JSON.parse(await readFile('.astro/bloggpt-bundle-assets.json', 'utf8')),
);
const files = (await walk('dist')).filter(
  (file) => !attachments.has(file.replaceAll('\\', '/').replace(/^dist\//, '')),
);
const excluded = new Set();
const canonicalPattern = /<link\s+[^>]*rel="canonical"[^>]*href="([^"]+)"/;
for (const file of files.filter((file) => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  if (/<meta\s+[^>]*name="robots"[^>]*content="noindex/.test(html)) {
    if (/<meta\s+[^>]*http-equiv="refresh"/i.test(html)) continue;
    const canonical = html.match(canonicalPattern)?.[1];
    if (canonical) excluded.add(canonical.replaceAll('&amp;', '&'));
  }
}
// @astrojs/sitemap cannot read rendered page-level robots metadata. Remove unlisted pages
// after rendering, using canonical URLs so base paths and non-ASCII slugs remain correct.
for (const file of files.filter((file) => /sitemap-\d+\.xml$/.test(file))) {
  const xml = await readFile(file, 'utf8');
  const filtered = xml.replace(/<url>[\s\S]*?<\/url>/g, (entry) => {
    const url = entry
      .match(/<loc>([\s\S]*?)<\/loc>/)?.[1]
      ?.replaceAll('&amp;', '&');
    return excluded.has(url) ? '' : entry;
  });
  await writeFile(file, filtered);
}
const records = [];
for (const file of files.filter((file) => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  const canonical = html.match(canonicalPattern)?.[1]?.replaceAll('&amp;', '&');
  if (!canonical || excluded.has(canonical)) continue;
  records.push(...searchRecords(html));
}
// Multiple introductions on a route share one result.
const grouped = new Map();
for (const record of records) {
  const key = `${record.language.toLowerCase()}:${record.url}`;
  const prior = grouped.get(key);
  grouped.set(
    key,
    prior
      ? {
          ...prior,
          body: `${prior.body} ${record.body}`,
          sections: [...prior.sections, ...record.sections],
        }
      : record,
  );
}
await mkdir('dist/search', { recursive: true });
const languages = new Set(
  [...grouped.values()].map((record) => record.language.toLowerCase()),
);
// Empty locales deliberately have no index; the client returns no cross-language fallback.
for (const language of languages) {
  const entries = [...grouped.values()].filter(
    (record) => record.language.toLowerCase() === language,
  );
  await writeFile(
    `dist/search/${language}.json`,
    JSON.stringify(buildSearchDatabase(entries)),
  );
  console.log(`Orama ${language}: ${entries.length} content pages.`);
}
console.log(
  `Excluded ${excluded.size} non-discoverable URLs from Sitemap and search.`,
);
