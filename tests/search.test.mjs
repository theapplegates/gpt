import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { searchScope } from '../src/lib/search.ts';
import { searchRecords } from '../scripts/lib/search-records.mjs';
import { oramaSearch, highlightText } from '../src/lib/search-client.ts';
import { buildSearchDatabase } from '../scripts/lib/orama-search.mjs';
import { contentUrls } from '../src/lib/content-urls.ts';
import { contextSnippets } from '../src/lib/search-context.ts';
import { parse } from 'parse5';
import config from '../blog.config.ts';
import { localeHref } from '../src/lib/locale-routing.ts';
const site = { ...config.site, base: new URL(config.site.baseUrl).pathname };
const lang = config.site.defaultLocale;
const built = (route) => `dist${localeHref(site, lang, route)}`;

test('rendered paragraphs have unique destinations without replacing author IDs or indexing hidden content', () => {
  const html = `<html lang="zh"><head><link rel="canonical" href="https://bloggpt.paulapplegate.com/zh/posts/test/"></head><body><nav><p>Navigation</p></nav><span id="search-paragraph-1"></span><main><article data-search-record="posts" data-search-title="搜索"><div class="article-content" data-search-content><h2 id="section">章节搜索</h2><p>第一段搜索 <a href="https://example.org/">链接</a></p><p id="custom">第二段搜索</p><ul><li><p>列表搜索</p><ul><li>嵌套搜索</li></ul></li></ul><aside data-search-ignore><p>Hidden search</p></aside><pre><code>code search</code></pre></div></article></main></body></html>`;
  const rendered = contentUrls(
    html,
    new URL('https://bloggpt.paulapplegate.com/zh/posts/test/'),
  );
  assert.equal(
    contentUrls(
      rendered,
      new URL('https://bloggpt.paulapplegate.com/zh/posts/test/'),
    ),
    rendered,
    'Anchoring must be idempotent',
  );
  const tree = parse(rendered);
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    (node.childNodes ?? []).forEach(visit);
  };
  visit(tree);
  const attr = (node, name) =>
    node.attrs?.find((item) => item.name === name)?.value;
  const ids = nodes.map((node) => attr(node, 'id')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(rendered.includes('<p id="custom" data-search-paragraph>'));
  assert.ok(rendered.includes('<nav><p>Navigation</p></nav>'));
  assert.ok(
    rendered.includes('<aside data-search-ignore><p>Hidden search</p></aside>'),
  );
  const [record] = searchRecords(rendered);
  const snippets = contextSnippets(record.sections, '搜索');
  assert.deepEqual(
    snippets.map((item) => item.text),
    ['章节搜索', '第一段搜索 链接', '第二段搜索', '列表搜索', '嵌套搜索'],
  );
  assert.equal(snippets[2].id, 'custom');
  assert.equal(new Set(snippets.map((item) => item.id)).size, snippets.length);
  for (const snippet of snippets.slice(1)) {
    const target = nodes.find((node) => attr(node, 'id') === snippet.id);
    assert.ok(['p', 'li'].includes(target.tagName));
    assert.equal(snippet.heading, '章节搜索');
  }
});

test('locale indexes load lazily, share requests, retry failures and respect navigation cancellation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const data = buildSearchDatabase([
    {
      title: 'Markdown',
      description: '',
      body: 'Markdown content',
      kind: 'posts',
      url: '/blog/en/post/',
      sections: [],
    },
  ]);
  const search = oramaSearch(
    '/blog/search/en.json',
    controller.signal,
    false,
    async (url) => {
      assert.equal(url, '/blog/search/en.json');
      calls++;
      if (calls === 1) throw new Error('Network failure');
      return Response.json(data);
    },
  );
  await assert.rejects(search('markdown', 'articles'), /Network failure/);
  const [first, second] = await Promise.all([
    search('Markd', 'articles'),
    search('Markdwon', 'articles'),
  ]);
  assert.equal(calls, 2);
  assert.equal(first[0].url, '/blog/en/post/');
  assert.equal(second[0].url, '/blog/en/post/');
  controller.abort();
  await assert.rejects(search('markdown', 'articles'), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('missing locale indexes never fall back to a different language', async () => {
  let calls = 0;
  const search = oramaSearch(
    '/search/en-gb.json',
    new AbortController().signal,
    false,
    async () => {
      calls++;
      return new Response('', { status: 404 });
    },
  );
  assert.deepEqual(await search('Markdown', 'all'), []);
  assert.deepEqual(await search('Markdown', 'title'), []);
  assert.equal(calls, 1);
});

test('cancelled requests cannot publish results after the shared index finishes loading', async () => {
  let resolve;
  const page = new AbortController(),
    request = new AbortController();
  const search = oramaSearch(
    '/search/en.json',
    page.signal,
    false,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = search('markdown', 'all', { signal: request.signal });
  request.abort();
  resolve(Response.json(buildSearchDatabase([])));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('highlighting treats markup as text and handles literal punctuation safely', () => {
  const original = globalThis.document;
  globalThis.document = {
    createElement: (tag) => ({ tag, textContent: '' }),
    createTextNode: (text) => ({ text }),
  };
  try {
    const children = [];
    highlightText(
      { append: (node) => children.push(node) },
      '<script>alert(1)</script> C++ Markdown',
      ['C++', 'Markdown'],
    );
    assert.deepEqual(
      children.filter((node) => node.tag).map((node) => node.textContent),
      ['C++', 'Markdown'],
    );
    assert.ok(children.some((node) => node.text?.includes('<script>')));
  } finally {
    globalThis.document = original;
  }
});

test('missing and invalid scopes default to articles', () => {
  assert.equal(searchScope(null), 'articles');
  assert.equal(searchScope('invalid'), 'articles');
});

test('rendered index extraction ignores navigation, share dialogs, title metadata and hidden script text in body', () => {
  const html = `<html lang="zh-CN"><head><link rel="canonical" href="https://bloggpt.paulapplegate.com/blog/zh/about/"></head><body><nav>Noise</nav><article data-search-record="pages" data-search-title="A &amp; B" data-search-description="Description"><h1>Title</h1><div data-search-content><p>Rendered <strong>MDX</strong></p><p>Next paragraph</p><script>Secret</script><span data-search-ignore>Ignore</span></div><section>Share dialog</section></article></body></html>`;
  assert.deepEqual(searchRecords(html), [
    {
      url: '/blog/zh/about/',
      language: 'zh-CN',
      kind: 'pages',
      title: 'A & B',
      description: 'Description',
      body: 'Rendered MDX Next paragraph',
      sections: [{ heading: '', id: '', text: 'Rendered MDX Next paragraph' }],
    },
  ]);
});

test('production indexes all four public content types and preserves independent page and bundle links', async () => {
  for (const locale of config.site.locales)
    await access(`dist/search/${locale.toLowerCase()}.json`);
  const routes = [
    ['posts/content-bundle', 'posts'],
    ['about', 'pages'],
    ['categories/guide', 'categories'],
    ['tags/astro', 'tags'],
  ];
  for (const [route, kind] of routes) {
    const html = await readFile(built(`${route}/index.html`), 'utf8');
    const records = searchRecords(html);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, kind);
    assert.ok(records[0].body.length > 20);
    assert.equal(records[0].body.includes('Powered by'), false);
    assert.equal(records[0].body.includes('Facebook'), false);
  }
  const unlisted = await readFile(built('posts/unlisted/index.html'), 'utf8');
  assert.deepEqual(searchRecords(unlisted), []);
  const about = await readFile(built('about/index.html'), 'utf8');
  assert.ok(about.includes('class="article-column"'));
  assert.ok(about.includes('data-article-toc'));
  await access(built('page-og/about.png'));
  const list = await readFile(built('posts/index.html'), 'utf8');
  assert.ok(list.includes('src="/images/covers/writing-typography.webp"'));
  const taxonomy = await readFile(built('categories/guide/index.html'), 'utf8');
  assert.ok(
    taxonomy.indexOf('taxonomy-detail-cover') < taxonomy.indexOf('<h1>'),
  );
});
