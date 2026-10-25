import 'fake-indexeddb/auto'; // IndexedDB for the offline tests
// jsdom lacks a few browser APIs the app uses.
window.scrollTo = () => {};
window.matchMedia ??= (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
});
HTMLElement.prototype.setPointerCapture ??= function () {};
HTMLElement.prototype.releasePointerCapture ??= function () {};
