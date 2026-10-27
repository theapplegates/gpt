import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Theme integration tests exercise the demo in both languages, independently of
// the owner's site settings and production dist. Never rewrite blog.config.ts.
const source = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(source, '.astro'), { recursive: true });
const workspace = await mkdtemp(path.join(source, '.astro', 'tests-'));
async function run(args) {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (status !== 0)
    throw new Error(`Test command failed (${status}): ${args.join(' ')}`);
}
try {
  for (const name of [
    'src',
    'content',
    'archetypes',
    'custom',
    'public',
    'scripts',
    'starter',
    'tests',
    'docs',
    '.github',
    'apps/docs',
    'README.md',
    'README.zh-CN.md',
    'astro.config.ts',
    'blog.config.ts',
    'friends.config.ts',
    'tsconfig.json',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'eslint.config.js',
    '.prettierrc.json',
    '.prettierignore',
    '.gitignore',
    '.gitattributes',
    'LICENSE',
    'NOTICE',
  ])
    await cp(path.join(source, name), path.join(workspace, name), {
      recursive: true,
      filter: (entry) =>
        !['node_modules', 'dist', '.astro', 'cache', '.git'].includes(
          path.basename(entry),
        ),
    });
  const configPath = path.join(workspace, 'blog.config.ts');
  let config = await readFile(configPath, 'utf8');
  for (const [name, value] of Object.entries({
    baseUrl: "'https://bloggpt.paulapplegate.com/'",
    defaultLocale: "'zh'",
    locales: "['zh', 'en']",
    localePrefixPolicy: "'redirect-to-default'",
    timezone: "'Asia/Shanghai'",
  }))
    config = config.replace(
      new RegExp(`^    ${name}:.*$`, 'm'),
      `    ${name}: ${value},`,
    );
  await writeFile(configPath, config);
  await run([path.join(source, 'node_modules/astro/bin/astro.mjs'), 'build']);
  await run(['scripts/build-search.mjs']);
  await run(['--experimental-strip-types', '--test', 'tests/*.test.mjs']);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
