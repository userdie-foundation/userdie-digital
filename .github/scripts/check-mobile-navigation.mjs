import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("website/index.html", "utf8");
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.includes('querySelector(".menu-toggle")'));

assert.equal(scripts.length, 1, "Expected exactly one inline mobile-navigation controller");

class Element {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.focused = false;
    this.classList = { add: (name) => this.classes.add(name) };
    this.classes = new Set();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, callback) {
    const list = this.listeners.get(name) ?? [];
    list.push(callback);
    this.listeners.set(name, list);
  }
  dispatch(name, event = {}) {
    for (const callback of this.listeners.get(name) ?? []) callback(event);
  }
  focus() { this.focused = true; }
}

function createEnvironment(isMobile) {
  const header = new Element();
  const toggle = new Element();
  const navigation = new Element();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const mediaListeners = new Map();
  const media = {
    matches: isMobile,
    addEventListener(name, callback) {
      const list = mediaListeners.get(name) ?? [];
      list.push(callback);
      mediaListeners.set(name, list);
    },
    change(next) {
      media.matches = next;
      for (const callback of mediaListeners.get("change") ?? []) callback({ matches: next });
    }
  };
  const document = {
    querySelector(selector) {
      return ({
        ".header": header,
        ".menu-toggle": toggle,
        "#primary-navigation": navigation
      })[selector] ?? null;
    },
    addEventListener(name, callback) {
      const list = documentListeners.get(name) ?? [];
      list.push(callback);
      documentListeners.set(name, list);
    },
    dispatch(name, event = {}) {
      for (const callback of documentListeners.get(name) ?? []) callback(event);
    }
  };
  const window = {
    matchMedia: () => media,
    addEventListener(name, callback) {
      const list = windowListeners.get(name) ?? [];
      list.push(callback);
      windowListeners.set(name, list);
    },
    dispatch(name, event = {}) {
      for (const callback of windowListeners.get(name) ?? []) callback(event);
    }
  };
  vm.runInNewContext(scripts[0], { document, window });
  return { header, toggle, navigation, document, window, media };
}

const mobile = createEnvironment(true);
assert.equal(mobile.header.classes.has("menu-enhanced"), true, "Header enhancement class is applied");
assert.equal(mobile.navigation.hidden, true, "Mobile navigation starts collapsed");
assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", "Initial aria-expanded is false");

mobile.toggle.dispatch("click");
assert.equal(mobile.navigation.hidden, false, "Toggle opens mobile navigation");
assert.equal(mobile.toggle.getAttribute("aria-expanded"), "true", "Opening updates aria-expanded");

mobile.document.dispatch("keydown", { key: "Escape" });
assert.equal(mobile.navigation.hidden, true, "Escape closes mobile navigation");
assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", "Escape resets aria-expanded");
assert.equal(mobile.toggle.focused, true, "Escape restores focus to the menu button");

mobile.toggle.dispatch("click");
mobile.navigation.dispatch("click", {
  target: { closest: (selector) => selector === "a" ? {} : null }
});
assert.equal(mobile.navigation.hidden, true, "Selecting a navigation link closes the mobile menu");

mobile.media.change(false);
assert.equal(mobile.navigation.hidden, false, "Desktop navigation remains visible");
assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", "Desktop layout resets expanded state");

mobile.media.change(true);
assert.equal(mobile.navigation.hidden, true, "Returning to mobile restores collapsed navigation");

const desktop = createEnvironment(false);
assert.equal(desktop.navigation.hidden, false, "Desktop navigation starts visible");
desktop.window.dispatch("resize");
assert.equal(desktop.navigation.hidden, false, "Desktop resize keeps navigation visible");

console.log("Mobile navigation behavior checks passed: initial state, open, Escape, focus restore, link close, mobile/desktop transitions, and resize.");
