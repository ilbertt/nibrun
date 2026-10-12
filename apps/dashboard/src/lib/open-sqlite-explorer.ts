export async function openSqliteExplorer({
  getUrl,
  getHref,
}: {
  getUrl: () => Promise<string>;
  getHref: (url: string) => string;
}): Promise<void> {
  // Reserve the tab during the click so an asynchronous connection does not trigger popup blocking.
  const tab = window.open('about:blank', '_blank');
  if (tab !== null) {
    tab.opener = null;
  }
  try {
    const href = getHref(await getUrl());
    if (tab === null) {
      window.location.assign(href);
    } else {
      tab.location.replace(href);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
