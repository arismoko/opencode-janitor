import hljs from 'https://esm.sh/highlight.js@11.11.1/lib/core';
import bash from 'https://esm.sh/highlight.js@11.11.1/lib/languages/bash';
import diff from 'https://esm.sh/highlight.js@11.11.1/lib/languages/diff';
import javascript from 'https://esm.sh/highlight.js@11.11.1/lib/languages/javascript';
import json from 'https://esm.sh/highlight.js@11.11.1/lib/languages/json';
import markdown from 'https://esm.sh/highlight.js@11.11.1/lib/languages/markdown';
import plaintext from 'https://esm.sh/highlight.js@11.11.1/lib/languages/plaintext';
import typescript from 'https://esm.sh/highlight.js@11.11.1/lib/languages/typescript';
import xml from 'https://esm.sh/highlight.js@11.11.1/lib/languages/xml';
import yaml from 'https://esm.sh/highlight.js@11.11.1/lib/languages/yaml';
import { Marked } from 'https://esm.sh/marked@17.0.2';
import { markedHighlight } from 'https://esm.sh/marked-highlight@2.2.3';

const MARKDOWN_CACHE_MAX = 200;

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('plaintext', plaintext);

const markdownRenderer = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    emptyLangClass: 'hljs',
    highlight(code, lang) {
      const normalized = String(lang || '')
        .trim()
        .toLowerCase();
      if (normalized && hljs.getLanguage(normalized)) {
        return hljs.highlight(code, { language: normalized }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
);

markdownRenderer.setOptions({ gfm: true, breaks: true });
markdownRenderer.use({
  renderer: {
    html() {
      // Drop raw HTML blocks/inline tags from model output.
      return '';
    },
  },
});

const markdownCache = new Map();

function markdownToHtml(source) {
  const text = typeof source === 'string' ? source : String(source ?? '');
  if (text.length === 0) return '';

  const cached = markdownCache.get(text);
  if (cached) return cached;

  const rendered = markdownRenderer.parse(text);
  const html = typeof rendered === 'string' ? rendered : String(rendered ?? '');

  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    markdownCache.clear();
  }
  markdownCache.set(text, html);
  return html;
}

export function renderMarkdownBlock(html, text) {
  const rendered = markdownToHtml(text);
  if (!rendered) return null;
  return html`
    <div class="timeline-markdown" dangerouslySetInnerHTML=${{ __html: rendered }}></div>
  `;
}

export function renderTextBlock(html, block) {
  if (block.isStreaming) {
    return html`
      <article class="timeline-text timeline-plain">
        <pre class="timeline-plain-content">${block.text || ''}</pre>
      </article>
    `;
  }

  return html`
    <article class="timeline-text">
      ${renderMarkdownBlock(html, block.text || '')}
    </article>
  `;
}
