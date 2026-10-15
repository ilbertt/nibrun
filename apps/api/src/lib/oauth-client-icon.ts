import { decodeHTMLAttribute } from 'entities';

export function websiteIcon({ html, url }: { html: string; url: URL }): string | null {
  let baseHref: string | null = null;
  const icons: string[] = [];
  const touchIcons: string[] = [];
  new HTMLRewriter()
    .on('head base[href]', {
      element(element) {
        baseHref ??= decodeHTMLAttribute(element.getAttribute('href')!);
      },
    })
    .on('head link[rel][href]', {
      element(element) {
        const rel = decodeHTMLAttribute(element.getAttribute('rel')!).toLowerCase().split(/\s+/);
        const href = decodeHTMLAttribute(element.getAttribute('href')!);
        if (rel.includes('icon')) {
          icons.push(href);
        } else if (rel.includes('apple-touch-icon')) {
          touchIcons.push(href);
        }
      },
    })
    .transform(html);

  const base = baseHref === null ? url : (httpsUrl({ value: baseHref, base: url }) ?? url);
  for (const href of [...icons, ...touchIcons]) {
    const icon = httpsUrl({ value: href, base });
    if (icon) {
      return icon.href;
    }
  }
  return null;
}

function httpsUrl({ value, base }: { value: string; base: URL }): URL | undefined {
  if (!value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}
