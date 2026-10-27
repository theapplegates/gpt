import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildSearchDatabase,
  restoreSearchDatabase,
  querySearchDatabase,
} from '../scripts/lib/orama-search.mjs';
import { contextSnippets } from '../src/lib/search-context.ts';
import { parse } from 'parse5';
import { contentUrls } from '../src/lib/content-urls.ts';
import { searchRecords } from '../scripts/lib/search-records.mjs';
import config from '../blog.config.ts';

const index = async (locale) =>
  restoreSearchDatabase(
    JSON.parse(await readFile(`dist/search/${locale}.json`, 'utf8')),
  );

test('matched terms keep query prefixes and typos without treating shorter words as prefixes', () => {
  const database = restoreSearchDatabase(
    buildSearchDatabase([
      {
        url: '/markdown/',
        kind: 'posts',
        title: 'Markdown typography',
        description: 'A guide to formatting',
        body: 'A guide to formatting. Apples. Astro documentation.',
        sections: [
          { heading: 'Body', id: 'body', text: 'A guide to formatting.' },
          { heading: 'Fruit', id: 'fruit', text: 'Apples' },
          { heading: 'Links', id: 'links', text: 'Astro documentation.' },
        ],
      },
      {
        url: '/welcome/',
        kind: 'posts',
        title: 'Welcome',
        description: '',
        body: 'Build a site with Astro.',
        sections: [],
      },
    ]),
  );
  for (const query of ['Apples', 'Appl', 'Aplles']) {
    const [result] = querySearchDatabase(database, query, 'all');
    assert.equal(result.url, '/markdown/');
    assert.deepEqual(result.matchedTerms, ['Apples']);
    assert.deepEqual(
      contextSnippets(result.sections, result.matchedTerms.join(' ')).map(
        (section) => section.id,
      ),
      ['fruit'],
    );
  }
  const results = querySearchDatabase(database, 'Astro', 'all');
  assert.equal(results.length, 2);
  for (const result of results)
    assert.deepEqual(result.matchedTerms, ['Astro']);
  assert.equal(
    querySearchDatabase(database, 'Welcome', 'all')[0].url,
    '/welcome/',
  );
});

test('serialized Orama indexes search Chinese headings and retain matching paragraph destinations', async () => {
  const html = contentUrls(
    `<html lang="zh"><head><link rel="canonical" href="https://example.org/zh/posts/design/"></head><body><article data-search-record="posts" data-search-title="设计"><div class="article-content" data-search-content><h2 id="heading">从聊天布局到博客</h2><p>搜索文章中的内容。</p><p>另一个搜索段落。</p></div></article></body></html>`,
    new URL('https://example.org/zh/posts/design/'),
  );
  const database = restoreSearchDatabase(
    buildSearchDatabase(searchRecords(html)),
  );
  const query = (term, scope = 'articles') =>
    querySearchDatabase(database, term, scope);
  const design = query('搜索').find((entry) =>
    entry.url.endsWith('/zh/posts/design/'),
  );
  assert.ok(design);
  const snippets = contextSnippets(design.sections, '搜索');
  assert.ok(snippets.length >= 2);
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    (node.childNodes ?? []).forEach(visit);
  };
  visit(parse(html));
  for (const snippet of snippets) {
    const target = nodes.find((node) =>
      node.attrs?.some(
        (attr) => attr.name === 'id' && attr.value === snippet.id,
      ),
    );
    assert.ok(target, `Missing rendered paragraph ${snippet.id}`);
    assert.ok(['p', 'table'].includes(target.tagName));
  }
  assert.equal(query('从聊天布局到博客', 'body').length, 1);
  assert.equal(query('博客', 'title').length, 0);
});

test('production search supports prefixes, typos, locale isolation and public-content exclusions', async () => {
  const database = await index(config.site.defaultLocale.toLowerCase());
  for (const term of ['Markdown', 'Markd', 'Markdwon']) {
    const results = querySearchDatabase(database, term, 'articles');
    assert.ok(results.length, term);
    assert.ok(
      results.every(
        (entry) =>
          entry.language.toLowerCase() ===
          config.site.defaultLocale.toLowerCase(),
      ),
    );
    assert.ok(
      results.every(
        (entry) => !/unlisted|draft-example|future-example/.test(entry.url),
      ),
    );
    assert.ok(
      results.some((entry) =>
        entry.matchedTerms.some((term) => /markdown/i.test(term)),
      ),
    );
  }
});

test('all scopes, title ranking, AND queries and contiguous CJK matching survive serialization', () => {
  const record = (url, kind, title, body, description = '') => ({
    url,
    kind,
    title,
    body,
    description,
    sections: [],
  });
  const database = restoreSearchDatabase(
    buildSearchDatabase([
      record('/en/title/', 'posts', 'Search engine', 'Some writing'),
      record('/en/body/', 'posts', 'Writing', 'Search engine'),
      record('/en/page/', 'pages', 'Search engine', 'Other page'),
      record(
        '/zh/separate/',
        'posts',
        '搜 unrelated 索',
        'Separate characters',
      ),
      record('/zh/contiguous/', 'posts', '搜索', 'Exact phrase'),
    ]),
  );
  assert.equal(
    querySearchDatabase(database, 'search', 'articles')[0].url,
    '/en/title/',
  );
  assert.deepEqual(
    querySearchDatabase(database, 'search', 'title').map((r) => r.url),
    ['/en/title/'],
  );
  assert.deepEqual(
    querySearchDatabase(database, 'search', 'body').map((r) => r.url),
    ['/en/body/'],
  );
  assert.equal(querySearchDatabase(database, 'search', 'all').length, 3);
  assert.equal(querySearchDatabase(database, 'search absent', 'all').length, 0);
  assert.deepEqual(
    querySearchDatabase(database, '搜索', 'all').map((r) => r.url),
    ['/zh/contiguous/'],
  );
  assert.equal(querySearchDatabase(database, ' ', 'all').length, 0);
});
