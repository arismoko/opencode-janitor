import { describe, expect, it } from 'bun:test';
import type { PromptConfig, ReviewContext } from '../types/review';
import { buildReviewPrompt } from './prompt-builder';

const baseConfig: PromptConfig = {
  scopeInclude: ['src/**'],
  scopeExclude: ['dist/**'],
  maxFindings: 10,
};

describe('buildReviewPrompt', () => {
  it('renders trigger/scope metadata and review hints when provided', () => {
    const context: ReviewContext = {
      mode: 'diff',
      label: 'PR review',
      trigger: 'manual',
      scope: 'pr',
      subject: 'manual:pr:123',
      scopeMetadata: ['PR #123'],
      changedFiles: [{ status: 'M', path: 'src/review.ts' }],
      patch: 'diff --git a/src/review.ts b/src/review.ts\n@@ -1 +1 @@\n-a\n+b',
      patchTruncated: false,
    };

    const prompt = buildReviewPrompt(context, {
      ...baseConfig,
      promptHints: ['Focus on API contract drift'],
    });

    expect(prompt).toContain('Trigger: manual');
    expect(prompt).toContain('Scope: pr');
    expect(prompt).toContain('Subject: manual:pr:123');
    expect(prompt).toContain('PR #123');
    expect(prompt).toContain('# REVIEW HINTS');
    expect(prompt).toContain('Focus on API contract drift');
  });

  it('renders diff context when mode=diff', () => {
    const context: ReviewContext = {
      mode: 'diff',
      label: 'Manual workspace review',
      metadata: ['Trigger: manual'],
      changedFiles: [{ status: 'M', path: 'src/app.ts' }],
      patch: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
      patchTruncated: false,
    };

    const prompt = buildReviewPrompt(context, baseConfig);

    expect(prompt).toContain('# REVIEW CONTEXT');
    expect(prompt).toContain('Changed files:');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('DIFF_TRUNCATED=false');
    expect(prompt).not.toContain(
      'No diff provided — this is a repo-wide analysis run.',
    );
    expect(prompt).not.toContain(
      'No workspace diff detected — falling back to a repo-wide analysis run.',
    );
  });

  it('renders repo-wide context when mode=repo and reason=manual-repo', () => {
    const context: ReviewContext = {
      mode: 'repo',
      label: 'Manual repo-wide analysis',
      reason: 'manual-repo',
      metadata: ['Trigger: manual', 'Mode: full codebase inspection'],
    };

    const prompt = buildReviewPrompt(context, baseConfig);

    expect(prompt).toContain('# REVIEW CONTEXT');
    expect(prompt).toContain(
      'No diff provided — this is a repo-wide analysis run.',
    );
    expect(prompt).not.toContain(
      'No workspace diff detected — falling back to a repo-wide analysis run.',
    );
    expect(prompt).not.toContain('DIFF_TRUNCATED=');
  });

  it('renders explicit fallback text for empty workspace fallback', () => {
    const context: ReviewContext = {
      mode: 'repo',
      label: 'Manual repo-wide analysis',
      reason: 'empty-workspace-fallback',
      metadata: [
        'Trigger: manual',
        'Mode: repo-wide fallback (workspace has no local changes)',
      ],
    };

    const prompt = buildReviewPrompt(context, baseConfig);

    expect(prompt).toContain(
      'No workspace diff detected — falling back to a repo-wide analysis run.',
    );
    expect(prompt).not.toContain(
      'No diff provided — this is a repo-wide analysis run.',
    );
  });
});
