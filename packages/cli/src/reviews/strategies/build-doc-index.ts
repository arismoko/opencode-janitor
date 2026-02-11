/**
 * Build a documentation index from repo file structure.
 *
 * Lightweight helper used by scribe-strategy to pre-scan for doc files
 * and pass them as context metadata.
 */

import { runGitCommand } from '../../utils/git';

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const DOC_DIRS = new Set(['docs', 'doc', 'documentation', '.github']);

function runGitOrEmpty(cwd: string, args: string[]): string {
  const result = runGitCommand(cwd, args);
  if (result.exitCode !== 0) {
    return '';
  }

  return result.stdout;
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
  const filesRaw = runGitOrEmpty(repoPath, ['ls-files', '*.md']);
  if (!filesRaw) {
    return null;
  }

  const rows = filesRaw
    .split('\n')
    .filter(Boolean)
    .map((file) => {
      const lastModified =
        runGitOrEmpty(repoPath, ['log', '-1', '--format=%cs', '--', file]) ||
        'unknown';
      return `- ${lastModified} ${file}`;
    });

  if (rows.length === 0) {
    return null;
  }

  return `Markdown files (last git-modified):\n${rows.join('\n')}`;
}
