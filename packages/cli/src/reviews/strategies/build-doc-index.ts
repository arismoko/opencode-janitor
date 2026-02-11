/**
 * Build a documentation index from repo file structure.
 *
 * Lightweight helper used by scribe-strategy to pre-scan for doc files
 * and pass them as context metadata.
 */

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const DOC_DIRS = new Set(['docs', 'doc', 'documentation', '.github']);

function runGit(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = proc.stdout.toString('utf8').trim();
  if (proc.exitCode !== 0) {
    return '';
  }

  return stdout;
}

/**
 * Given a list of repo-relative file paths, return those that look like
 * documentation files (by extension or parent directory).
 */
export function filterDocFiles(filePaths: string[]): string[] {
  return filePaths.filter((p) => {
    const lower = p.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    if (DOC_EXTENSIONS.has(ext)) return true;

    const segments = lower.split('/');
    return segments.some((seg) => DOC_DIRS.has(seg));
  });
}

/**
 * Build a concise metadata line summarising the doc files touched by a change.
 */
export function buildDocIndexMetadata(changedFiles: string[]): string | null {
  const docs = filterDocFiles(changedFiles);
  if (docs.length === 0) return null;
  return `Documentation files in changeset: ${docs.join(', ')}`;
}

/**
 * Build markdown inventory metadata for full-repo documentation audits.
 */
export function buildMarkdownFileInventoryMetadata(
  repoPath: string,
): string | null {
  const filesRaw = runGit(repoPath, ['ls-files', '*.md']);
  if (!filesRaw) {
    return null;
  }

  const rows = filesRaw
    .split('\n')
    .filter(Boolean)
    .map((file) => {
      const lastModified =
        runGit(repoPath, ['log', '-1', '--format=%cs', '--', file]) ||
        'unknown';
      return `- ${lastModified} ${file}`;
    });

  if (rows.length === 0) {
    return null;
  }

  return `Markdown files (last git-modified):\n${rows.join('\n')}`;
}
