import { useEffect } from 'react';

export function useEmbedSize(embedded: boolean): void {
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    const content = document.querySelector('.app-embed');
    if (!content) return;
    const report = () =>
      window.parent.postMessage(
        { type: 'sodax:resize', height: Math.ceil(content.getBoundingClientRect().height) },
        '*',
      );
    const observer = new ResizeObserver(report);
    observer.observe(content);
    report();
    return () => observer.disconnect();
  }, [embedded]);
}
