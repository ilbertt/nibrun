import { afterAll, beforeEach } from 'bun:test';

export function setupBrowserLocation(): Pick<Location, 'origin' | 'search'> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const location =
    typeof window === 'undefined' ? { origin: 'https://nibrun.test', search: '' } : window.location;
  const previousSearch = Object.getOwnPropertyDescriptor(location, 'search');
  if (!previousWindow) {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  }
  beforeEach(() => {
    location.search = '';
  });
  afterAll(() => {
    if (previousSearch) {
      Object.defineProperty(location, 'search', previousSearch);
    } else {
      Reflect.deleteProperty(location, 'search');
    }
    if (!previousWindow) {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
  return location;
}
