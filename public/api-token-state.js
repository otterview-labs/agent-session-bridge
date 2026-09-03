const LEGACY_STORAGE_KEY = 'asb.apiToken';

export function createApiTokenState({ localStorage, sessionStorage }) {
  // Older versions persisted the bearer token in Web Storage. Delete those
  // values without reading or migrating them into the current page.
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  sessionStorage.removeItem(LEGACY_STORAGE_KEY);

  let value = '';

  return Object.freeze({
    get() {
      return value;
    },

    set(nextValue) {
      value = typeof nextValue === 'string' ? nextValue.trim() : '';
    },
  });
}
