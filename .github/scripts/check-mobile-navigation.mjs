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

console.log("Mobile navigation checks passed on all 5 sitemap pages: markup, aria-controls, open/close, Escape, focus restore, link close, and responsive transitions.");

// The workspace module rail is a separate navigation surface from the public
// hamburger menu above. Guard its mobile CSS contract independently.
const workspaceHtml = fs.readFileSync("website/prototype/workspace.html", "utf8");
const workspaceCss = fs.readFileSync("website/prototype/styles.css", "utf8");
const inlineRailSelector = "body.workspace .app-sidebar .app-nav a.app-nav-link";
const cascadeSafeRailSelector = "body.workspace .app-sidebar .app-nav a.app-nav-link:not([hidden])";

assert.match(workspaceHtml, /<body[^>]*class=["'][^"']*\bworkspace\b/i,
  "workspace page must expose the workspace body scope");
assert.match(workspaceHtml, /\.app-nav\s*\{[^}]*display:grid/s,
  "workspace markup must retain its navigation container");
assert.ok(workspaceHtml.includes(inlineRailSelector),
  "workspace inline styles must be checked for the known external-link override");
assert.ok(workspaceCss.includes(cascadeSafeRailSelector),
  "external CSS must include the cascade-safe selector for visible module links");

const railContainerRule = /body\.workspace \.app-sidebar \.app-nav\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-wrap:\s*nowrap\s*!important;[^}]*overflow-x:\s*auto\s*!important;/s;
assert.match(workspaceCss, railContainerRule,
  "mobile module navigation must remain a horizontally scrollable, single-row rail");

const railLinkRule = /body\.workspace \.app-sidebar \.app-nav a\.app-nav-link:not\(\[hidden\]\)\s*\{[^}]*display:inline-flex!important;[^}]*flex:0 0 auto!important;[^}]*width:auto!important;[^}]*min-width:max-content!important;[^}]*white-space:nowrap!important;/s;
assert.match(workspaceCss, railLinkRule,
  "visible external module links must retain compact, non-wrapping rail sizing");

// :not([hidden]) contributes the [hidden] attribute to selector specificity,
// allowing the external stylesheet to beat the later inline-style rule.
assert.ok(cascadeSafeRailSelector.includes(":not([hidden])"),
  "the mobile link override must retain its specificity safeguard");

console.log("Workspace mobile rail checks passed: horizontal scrolling, single-row layout, compact visible external links, and inline-style cascade safeguard.");


// Partner page mobile contrast safeguards: opaque sticky header and dark footer.
assert.match(workspaceCss, /body\.partner-page \.header\s*\{[^}]*background:#f3f0e7!important;[^}]*backdrop-filter:none!important;/s,
  "partner page mobile header must be opaque to prevent content bleeding through");
assert.match(workspaceCss, /body\.partner-page footer\.footer\s*\{[^}]*background:#173f32!important;[^}]*color:#f3f0e7!important;/s,
  "partner page footer must retain its dark surface and readable base text");
assert.match(workspaceCss, /body\.partner-page footer\.footer \.brand small,[\s\S]*?body\.partner-page footer\.footer p\s*\{[^}]*color:#d7dfd7!important;[^}]*opacity:1!important;/,
  "partner page footer secondary text must remain readable at full opacity");

console.log("Partner page mobile contrast checks passed: opaque header and readable dark footer.");


// Verify the actual pages load the stylesheet layers covered by the contrast fix.
const homepageHtml = fs.readFileSync("website/index.html", "utf8");
const homepageBaseCss = fs.readFileSync("website/styles.css", "utf8");
const homepagePolishCss = fs.readFileSync("website/homepage-polish.css", "utf8");
const partnerHtml = fs.readFileSync("website/prototype/partner-space.html", "utf8");
const partnerRefinementCss = fs.readFileSync("website/prototype/cabinet-refinement.css", "utf8");

const homepageBaseLink = homepageHtml.indexOf('href="styles.css"');
const homepageRefinementLink = homepageHtml.indexOf('href="homepage-refinement.css"');
const homepagePolishLink = homepageHtml.indexOf('href="homepage-polish.css"');
assert.ok(homepageBaseLink >= 0 && homepageRefinementLink > homepageBaseLink && homepagePolishLink > homepageRefinementLink,
  "homepage stylesheet load order must be checked before relying on base and later refinement rules");
assert.match(homepageHtml, /<div class="robot-panel"[\s\S]*?<article class="robot-item">[\s\S]*?<strong>[\s\S]*?<p>/,
  "homepage assistant cards must retain their semantic heading and description markup");
assert.match(homepageBaseCss, /body \.robot-panel \.robot-item strong\s*\{\s*color:#26372c!important\s*\}/,
  "homepage light assistant cards must override inherited white headings with accessible dark text");
assert.match(homepageBaseCss, /body \.robot-panel \.robot-item p\s*\{\s*color:#59685d!important\s*\}/,
  "homepage light assistant cards must override inherited pale descriptions with accessible dark text");
assert.ok(homepagePolishCss.includes(".robot-panel .robot-item") === false,
  "later homepage polish must not silently introduce an unreviewed assistant-card text override");

const partnerBaseLink = partnerHtml.indexOf('href="styles.css"');
const partnerRefinementLink = partnerHtml.indexOf('href="cabinet-refinement.css"');
assert.ok(partnerBaseLink >= 0 && partnerRefinementLink > partnerBaseLink,
  "partner page must load its refinement stylesheet after the shared prototype stylesheet");
assert.match(partnerHtml, /<body class="[^"]*partner-page/);
assert.match(partnerRefinementCss, /\.partner-page \.footer\{background:#173f32;color:#f3f0e7\}/,
  "partner refinement must preserve the dark footer surface");
assert.match(workspaceCss, /body\.partner-page footer\.footer\s*\{\s*background:#173f32!important;\s*color:#f3f0e7!important;/,
  "the partner-page footer override must outrank later shared footer rules");
assert.match(workspaceCss, /body\.partner-page \.header\s*\{\s*background:#f3f0e7!important;/,
  "the partner-page sticky header must use a fully opaque surface");

console.log("Page-level contrast checks passed: homepage stylesheet order and assistant card text, partner header and footer cascade.");
