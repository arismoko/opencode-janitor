export function renderFlashToast({ html, flash }) {
  if (!flash) return null;

  return html`
    <div
      class="flash"
      style=${
        flash.tone === 'error'
          ? 'border-left-color:var(--error);'
          : flash.tone === 'warn'
            ? 'border-left-color:var(--warn);'
            : 'border-left-color:var(--accent);'
      }
    >
      ${flash.message}
    </div>
  `;
}
