import { renderMarkdownContent } from '../../../utils/markdown.js';

export function renderMarkdownBlock(html, text) {
  return renderMarkdownContent(
    html,
    text,
    'timeline-markdown markdown-content',
  );
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
