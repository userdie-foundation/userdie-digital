import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const publicPages = [
  "website/index.html",
  "website/prototype/aid-directions.html",
  "website/prototype/platform.html",
  "website/prototype/project-portfolio.html",
  "website/prototype/assets-and-intellectual-capital.html"
];

class Element {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.focused = false;
    this.classes = new Set();
    this.classList = { add: (name) => this.classes.add(name) };
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

function createEnvironment(source, isMobile) {
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
  vm.runInNewContext(source, { document, window });
  return { header, toggle, navigation, document, window, media };
}

for (const page of publicPages) {
  const html = fs.readFileSync(page, "utf8");
  const buttons = [...html.matchAll(/<button\b[^>]*class=["'][^"']*\bmenu-toggle\b[^"']*["'][^>]*>/gi)];
  const navs = [...html.matchAll(/<nav\b[^>]*id=["']primary-navigation["'][^>]*>/gi)];
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.includes('querySelector(".menu-toggle")'));

  assert.equal(buttons.length, 1, page + ": expected one menu toggle");
  assert.equal(navs.length, 1, page + ": expected one primary navigation");
  assert.match(buttons[0][0], /aria-controls=["']primary-navigation["']/, page + ": aria-controls must target primary navigation");
  assert.equal(scripts.length, 1, page + ": expected one mobile-navigation controller");

  const mobile = createEnvironment(scripts[0], true);
  assert.equal(mobile.header.classes.has("menu-enhanced"), true, page + ": header enhancement class is applied");
  assert.equal(mobile.navigation.hidden, true, page + ": mobile navigation starts collapsed");
  assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", page + ": initial aria-expanded is false");

  mobile.toggle.dispatch("click");
  assert.equal(mobile.navigation.hidden, false, page + ": toggle opens mobile navigation");
  assert.equal(mobile.toggle.getAttribute("aria-expanded"), "true", page + ": opening updates aria-expanded");

  mobile.document.dispatch("keydown", { key: "Escape" });
  assert.equal(mobile.navigation.hidden, true, page + ": Escape closes mobile navigation");
  assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", page + ": Escape resets aria-expanded");
  assert.equal(mobile.toggle.focused, true, page + ": Escape restores focus to the menu button");

  mobile.toggle.dispatch("click");
  mobile.navigation.dispatch("click", {
    target: { closest: (selector) => selector === "a" ? {} : null }
  });
  assert.equal(mobile.navigation.hidden, true, page + ": selecting a link closes the menu");

  mobile.media.change(false);
  assert.equal(mobile.navigation.hidden, false, page + ": desktop navigation remains visible");
  assert.equal(mobile.toggle.getAttribute("aria-expanded"), "false", page + ": desktop resets expanded state");

  mobile.media.change(true);
  assert.equal(mobile.navigation.hidden, true, page + ": returning to mobile collapses navigation");

  const desktop = createEnvironment(scripts[0], false);
  assert.equal(desktop.navigation.hidden, false, page + ": desktop navigation starts visible");
  desktop.window.dispatch("resize");
  assert.equal(desktop.navigation.hidden, false, page + ": desktop resize keeps navigation visible");
}

const workspaceCss = fs.readFileSync("website/prototype/workspace-visual-refinement.css", "utf8");
assert.match(workspaceCss, /@media\\s*\\(max-width:\\s*720px\\)[\\s\\S]*?body\\.workspace \\.app-nav button,[\\s\\S]*?flex-direction:\\s*row\\s*;/,
  "workspace mobile navigation must keep each icon and label on a horizontal row");
assert.match(workspaceCss, /body\\.workspace \\.app-nav \\.app-nav-link[\\s\\S]*?flex-direction:\\s*row\\s*;/,
  "workspace mobile navigation links must use the same horizontal layout");

console.log("Mobile navigation checks passed on all 5 sitemap pages and workspace horizontal navigation: markup, aria-controls, open/close, Escape, focus restore, link close, and responsive transitions.");
