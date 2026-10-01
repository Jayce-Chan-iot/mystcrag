import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as galleryPage from "../gallery/components/gallery-page";
import type { GalleryEntry } from "../gallery/model/gallery-model";
import * as profilePage from "../profile/components/profile-page";
import type { ProfileLevel, ProfileTab } from "../profile/model/profile-model";
import { mockDesignOptions } from "./fixtures/mock-design-options";

function source(rel: string): string {
  const url = new URL(rel, import.meta.url);
  if (!existsSync(url)) {
    assert.fail(`missing file: ${rel}`);
  }
  return readFileSync(url, "utf8");
}

const CONTENT_SOURCES = {
  library: "../../../src/features/library/components/crystal-library-page.tsx",
  gallery: "../../../src/features/gallery/components/gallery-page.tsx",
  profile: "../../../src/features/profile/components/profile-page.tsx",
  designDetail: "../../../app/design/[id]/page.tsx",
  starContent: "../../../app/styles/star-content.css",
  libraryModel: "../../../src/features/library/model/library-model.ts",
  galleryModel: "../../../src/features/gallery/model/gallery-model.ts",
  profileModel: "../../../src/features/profile/model/profile-model.ts"
} as const;

test("every content route root declares data-star-surface", () => {
  for (const [name, rel] of Object.entries(CONTENT_SOURCES)) {
    if (name === "starContent" || name.endsWith("Model")) continue;
    const text = source(rel);
    assert.match(
      text,
      /data-star-surface=/,
      `${name} must declare a data-star-surface route root`
    );
  }
  assert.match(source(CONTENT_SOURCES.library), /data-star-surface="library"/);
  assert.match(source(CONTENT_SOURCES.gallery), /data-star-surface="gallery"/);
  assert.match(source(CONTENT_SOURCES.profile), /data-star-surface="profile"/);
});

test("content pages never render the PageScaffold placeholder", () => {
  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile,
    CONTENT_SOURCES.designDetail
  ]) {
    const text = source(rel);
    assert.doesNotMatch(text, /PageScaffold/, `${rel} must not use the PageScaffold placeholder`);
    assert.doesNotMatch(
      text,
      /工程骨架已就绪/,
      `${rel} must not render the scaffold placeholder copy`
    );
  }
});

test("filters keep persistent visible labels instead of placeholder-only cues", () => {
  const library = source(CONTENT_SOURCES.library);
  const gallery = source(CONTENT_SOURCES.gallery);

  // Filter sections must carry persistent visible labels (not only sr-only).
  assert.match(library, /data-star-filter-label=/, "library filter labels must be marked");
  assert.match(gallery, /data-star-filter-label=/, "gallery filter labels must be marked");

  // Search fields keep a real accessible name plus a persistent cue.
  assert.match(library, /data-star-filter-field="search"/);
  assert.match(gallery, /data-star-filter-field="search"/);
});

test("zero-stock items report truthfulness as text marks, not color alone", () => {
  const library = source(CONTENT_SOURCES.library);
  const libraryModel = source(CONTENT_SOURCES.libraryModel);

  assert.match(libraryModel, /stockStatusLabel/, "library model must expose a stock text label");
  assert.match(library, /data-stock-mark=/, "library cards must carry a stock text mark");
  assert.match(library, /需补货|有库存/);
});

test("private/public state marks use text, not color alone", () => {
  const gallery = source(CONTENT_SOURCES.gallery);
  const galleryModel = source(CONTENT_SOURCES.galleryModel);
  const profile = source(CONTENT_SOURCES.profile);

  assert.match(galleryModel, /visibilityLabelFor/, "gallery model must expose visibility text");
  assert.match(galleryModel, /"私密"/, "visibility model returns the private text mark");
  assert.match(galleryModel, /"公开"/, "visibility model returns the public text mark");
  assert.match(gallery, /data-visibility-mark=/, "gallery cards must carry a visibility text mark");
  assert.match(gallery, /visibilityLabelFor/, "gallery must render visibility text from the model");
  assert.match(profile, /data-visibility-mark=|visibilityLabelFor/, "profile must surface visibility text");
});

test("profile query tabs resolve the workbench deep links", () => {
  const profile = source(CONTENT_SOURCES.profile);
  const profileModel = source(CONTENT_SOURCES.profileModel);

  assert.match(profileModel, /resolveProfileTab/, "profile model must resolve tab query values");
  assert.match(profile, /resolveProfileTab/, "profile page must call resolveProfileTab");
  assert.match(profile, /tab=|searchParams|location\.search/, "profile must read the tab query");
});

test("cards keep photographic bead images without CSS recoloring", () => {
  const starContent = source(CONTENT_SOURCES.starContent);
  for (const rel of [CONTENT_SOURCES.library, CONTENT_SOURCES.gallery, CONTENT_SOURCES.profile]) {
    assert.match(source(rel), /CrystalBeadImage/, `${rel} must use CrystalBeadImage for product photos`);
  }
  assert.doesNotMatch(
    starContent,
    /data-photo-real-bead[^}]*\{[^}]*(?:filter|mix-blend|background-blend)/s,
    "star-content must not tint photographic bead images"
  );
  assert.doesNotMatch(
    starContent,
    /\[data-star-content-card\][^{]*\{[^}]*(?:filter:\s*hue|filter:\s*sepia|filter:\s*saturate)/s,
    "content cards must not recolor product imagery"
  );
});

test("empty and no-result states expose a real recovery action", () => {
  for (const [name, rel] of [
    ["library", CONTENT_SOURCES.library],
    ["gallery", CONTENT_SOURCES.gallery],
    ["profile", CONTENT_SOURCES.profile]
  ] as const) {
    const text = source(rel);
    assert.match(text, /data-star-empty/, `${name} must mark empty states`);
    assert.match(text, /data-star-recovery/, `${name} empty/no-result states must expose recovery`);
  }
});

test("content grammar keeps 44px targets, scoping, and reduced-motion safety", () => {
  const css = source(CONTENT_SOURCES.starContent);

  assert.match(css, /\[data-star-surface/, "star-content rules stay scoped to data-star-surface");
  assert.match(css, /min-height:\s*2\.75rem|min-width:\s*2\.75rem|44px/, "content controls keep the 44px floor");
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m, "star-content must not use zoom");
  assert.doesNotMatch(
    css,
    /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s,
    "star-content must not scale html/body"
  );
});

test("content pages avoid AI-gradient, glassmorphism, and prohibited claim copy", () => {
  const bannedUi = [
    /backdrop-filter:\s*blur/i,
    /linear-gradient\([^)]*purple/i,
    /linear-gradient\([^)]*#a855f7/i,
    /glass(?:morph)?/i
  ];
  const bannedCopy = [
    /转运/,
    /招财/,
    /发财/,
    /保平安/,
    /辟邪/,
    /开光/,
    /加持/,
    /治愈/,
    /疗愈/,
    /命定/,
    /注定/,
    /一定让你/,
    /必定/,

    /大师/,
    /功效/,
    /疗效/
  ];

  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile,
    CONTENT_SOURCES.designDetail,
    CONTENT_SOURCES.starContent
  ]) {
    const text = source(rel);
    for (const pattern of bannedUi) {
      assert.doesNotMatch(text, pattern, `${rel} must avoid AI/glass decorative treatments`);
    }
    for (const pattern of bannedCopy) {
      assert.doesNotMatch(text, pattern, `${rel} must avoid prohibited claim copy`);
    }
  }
});

test("visible content copy avoids em-dash filler and status stays text-bearing", () => {
  for (const rel of [
    CONTENT_SOURCES.library,
    CONTENT_SOURCES.gallery,
    CONTENT_SOURCES.profile
  ]) {
    const text = source(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // JSX text nodes and string literals should not introduce —— as filler copy.
    assert.doesNotMatch(text, /——/, `${rel} must avoid em-dash filler in visible copy`);
    assert.doesNotMatch(text, /—(?!>)/, `${rel} must avoid single em-dash filler`);
  }

  const gallery = source(CONTENT_SOURCES.gallery);
  assert.match(gallery, /data-status-mark=/, "gallery status marks must be explicit text marks");
  const profile = source(CONTENT_SOURCES.profile);
  assert.match(profile, /data-status-mark=|ORDER_STATUS_PRESENTATION/, "profile status stays text-bearing");
});

// ---------------------------------------------------------------------------
// Mounted interaction contracts
//
// The regex contracts above cannot see behaviour, so these mount the real
// production page components and invoke the real `onClick` props collected by
// walking the rendered element tree. That is the repository's no-DOM-library
// harness from `auth-status.test.tsx`: hook-free production components are
// invoked directly, and third-party components such as `next/link` are left to
// `renderToStaticMarkup`.
//
// They fail on the pre-repair behaviour: the profile tab was pinned by a local
// `manualTab` override with no URL write-back, no tab navigation existed below
// `lg`, non-featured gallery overlays were hover-only, and the featured card
// dropped the revision-aware delete action.
// ---------------------------------------------------------------------------

type HostProps = Record<string, unknown>;

type HostElement = {
  readonly type: string;
  readonly props: HostProps;
};

type HookFreeComponent = (props: HostProps) => unknown;

type ProfileTabNavigationLike = {
  readonly activeTab: ProfileTab;
  readonly selectTab: (tab: ProfileTab) => void;
};

function mount(Component: HookFreeComponent, props: HostProps): React.ReactElement {
  return React.createElement(Component as React.ComponentType<HostProps>, props) as React.ReactElement;
}

function hostTree(node: unknown, hookFree: readonly unknown[]): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => hostTree(child, hookFree));
  }
  if (!React.isValidElement(node)) {
    return [];
  }
  const props = node.props as HostProps;
  if (typeof node.type === "function") {
    if (!hookFree.includes(node.type)) return [];
    return hostTree((node.type as HookFreeComponent)(props), hookFree);
  }
  if (typeof node.type !== "string") {
    return hostTree(props.children, hookFree);
  }
  return [{ type: node.type, props }, ...hostTree(props.children, hookFree)];
}

function requireExport<T>(value: T | undefined, name: string): T {
  assert.ok(value !== undefined, `${name} must be exported from the content page so its behaviour is testable`);
  return value;
}

function findHost(
  root: React.ReactElement,
  hookFree: readonly unknown[],
  predicate: (element: HostElement) => boolean,
  label: string
): HostElement {
  const match = hostTree(root, hookFree).find(predicate);
  assert.ok(match, `mounted tree must contain ${label}`);
  return match as HostElement;
}

function findHosts(
  root: React.ReactElement,
  hookFree: readonly unknown[],
  predicate: (element: HostElement) => boolean
): HostElement[] {
  return hostTree(root, hookFree).filter(predicate);
}

function classTokens(element: HostElement): string[] {
  const className = element.props.className;
  return typeof className === "string" ? className.split(/\s+/).filter(Boolean) : [];
}

function clickHost(element: HostElement, label: string): void {
  const onClick = element.props.onClick;
  assert.equal(typeof onClick, "function", `${label} must expose a real click handler`);
  (onClick as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} });
}

function profileTabNav(): HookFreeComponent {
  return requireExport(profilePage.ProfileTabNav as HookFreeComponent | undefined, "ProfileTabNav");
}

function profileTabsFrame(): HookFreeComponent {
  return requireExport(profilePage.ProfileTabsFrame as HookFreeComponent | undefined, "ProfileTabsFrame");
}

function galleryCard(): HookFreeComponent {
  return requireExport(galleryPage.GalleryDesignCard as HookFreeComponent | undefined, "GalleryDesignCard");
}

const PROFILE_TAB_LABELS: Readonly<Record<ProfileTab, string>> = {
  overview: "账户概览",
  designs: "我的设计",
  orders: "我的订单",
  favorites: "我的收藏",
  addresses: "地址管理",
  settings: "设置与帮助"
};

const ALL_PROFILE_TABS: readonly ProfileTab[] = ["overview", "designs", "orders", "favorites", "addresses", "settings"];

const FRAME_IDENTITY = { name: "小玄机", email: "", phone: "" };
const FRAME_LEVEL: ProfileLevel = { level: 1, title: "初识水晶" };

/**
 * Wires the production navigation factory against a mutable query store, so a
 * click writes an addressable URL and the store stands in for the router
 * updating `?tab=` while the profile route itself stays mounted.
 */
function mountProfileNavigation(initialTab: string | null) {
  const create = requireExport(
    profilePage.createProfileTabNavigation as
      | ((input: { readTabQuery: () => string | null; navigate: (href: string) => void }) => ProfileTabNavigationLike)
      | undefined,
    "createProfileTabNavigation"
  );
  const query: { tab: string | null } = { tab: initialTab };
  const pushed: string[] = [];
  const navigation = create({
    readTabQuery: () => query.tab,
    navigate: (href) => {
      pushed.push(href);
      query.tab = new URL(href, "https://mystcrag.invalid").searchParams.get("tab");
    }
  });
  return { navigation, pushed, query };
}

function profileFrameElement(navigation: ProfileTabNavigationLike): React.ReactElement {
  return mount(profileTabsFrame(), {
    identity: FRAME_IDENTITY,
    level: FRAME_LEVEL,
    navigation,
    onEditIdentity: () => {},
    renderPanel: (tab: ProfileTab) =>
      React.createElement("div", { "data-profile-tab-panel": tab }, PROFILE_TAB_LABELS[tab])
  });
}

function tabStripElement(navigation: ProfileTabNavigationLike, variant: "sidebar" | "mobile"): React.ReactElement {
  return mount(profileTabNav(), { navigation, variant });
}

test("profile tab hrefs round-trip through the tab query", () => {
  const hrefFor = requireExport(
    profilePage.profileTabHref as ((tab: ProfileTab) => string) | undefined,
    "profileTabHref"
  );
  assert.equal(hrefFor("overview"), "/profile", "the overview is the bare route");
  for (const tab of ALL_PROFILE_TABS.filter((item) => item !== "overview")) {
    const href = hrefFor(tab);
    assert.equal(href, `/profile?tab=${tab}`, `${tab} must be addressable through ?tab=`);
    const resolved = mountProfileNavigation(new URL(href, "https://mystcrag.invalid").searchParams.get("tab"));
    assert.equal(resolved.navigation.activeTab, tab, `${href} must resolve back to ${tab}`);
  }
  const bare = mountProfileNavigation(null);
  assert.equal(bare.navigation.activeTab, "overview", "a query-less profile URL is the overview tab");
});

test("mounting profile on the designs deep link shows the designs panel only", () => {
  const { navigation } = mountProfileNavigation("designs");
  const markup = renderToStaticMarkup(profileFrameElement(navigation));
  assert.match(markup, /data-profile-tab-panel="designs"/, "the deep link must mount the designs panel");
  assert.doesNotMatch(markup, /data-profile-tab-panel="overview"/, "only one panel mounts at a time");
  const current = findHost(
    profileFrameElement(navigation),
    [profileTabsFrame(), profileTabNav()],
    (element) => element.props["data-profile-tab"] === "designs",
    "the designs tab control"
  );
  assert.equal(current.props["aria-current"], "page", "the tab resolved from the URL is the current one");
});

test("clicking a profile tab pushes the tab URL instead of pinning local state", () => {
  const { navigation, pushed, query } = mountProfileNavigation(null);
  const orders = findHost(
    profileFrameElement(navigation),
    [profileTabsFrame(), profileTabNav()],
    (element) => element.props["data-profile-tab"] === "orders",
    "the orders tab control"
  );
  clickHost(orders, "orders tab control");
  assert.deepEqual(pushed, ["/profile?tab=orders"], "the click must write the tab into the URL");
  assert.equal(query.tab, "orders");
  assert.equal(navigation.activeTab, "orders", "the active tab must come straight from the query");
});

test("a later query change on the same profile route wins over the clicked tab", () => {
  const { navigation, query } = mountProfileNavigation("designs");
  navigation.selectTab("orders");
  assert.equal(navigation.activeTab, "orders");
  query.tab = "favorites";
  assert.equal(
    navigation.activeTab,
    "favorites",
    "a locally pinned tab must not outlive the URL that replaced it"
  );
  const markup = renderToStaticMarkup(profileFrameElement(navigation));
  assert.match(markup, /data-profile-tab-panel="favorites"/);
  assert.doesNotMatch(markup, /data-profile-tab-panel="orders"/);
});

test("the mobile tab strip stays mounted on every profile tab", () => {
  const { navigation } = mountProfileNavigation(null);
  for (const tab of ALL_PROFILE_TABS) {
    navigation.selectTab(tab);
    const markup = renderToStaticMarkup(profileFrameElement(navigation));
    assert.match(
      markup,
      /data-profile-tab-nav="mobile"/,
      `the mobile strip must stay mounted on the ${tab} tab, not only on the overview`
    );
    assert.match(markup, new RegExp(`data-profile-tab-panel="${tab}"`), `the ${tab} panel must mount`);
  }
});

test("the mobile tab strip is visible and keyboard reachable for every tab", () => {
  const { navigation } = mountProfileNavigation("designs");
  const hookFree = [profileTabNav()];
  const strip = findHost(
    tabStripElement(navigation, "mobile"),
    hookFree,
    (element) => element.props["data-profile-tab-nav"] === "mobile",
    "the mobile tab navigation"
  );
  const classes = classTokens(strip);
  assert.ok(classes.includes("lg:hidden"), "the mobile strip yields to the sidebar from lg upwards");
  assert.ok(!classes.includes("hidden"), "the mobile strip must not be display:none below lg");

  const buttons = findHosts(
    tabStripElement(navigation, "mobile"),
    hookFree,
    (element) => element.type === "button"
  );
  assert.equal(buttons.length, ALL_PROFILE_TABS.length, "every profile tab is reachable on mobile");
  for (const button of buttons) {
    const tab = button.props["data-profile-tab"] as ProfileTab;
    assert.ok(ALL_PROFILE_TABS.includes(tab), `unexpected tab control ${String(tab)}`);
    assert.notEqual(button.props.tabIndex, -1, `${tab} must stay in the keyboard tab order`);
    assert.ok(
      classTokens(button).some((token) => token.startsWith("min-h-11")),
      `${tab} must keep the 44px touch target`
    );
  }
});

test("mobile navigation crosses between sections and back to the overview", () => {
  const { navigation, pushed } = mountProfileNavigation("designs");
  const hookFree = [profileTabNav()];
  for (const [tab, href] of [
    ["orders", "/profile?tab=orders"],
    ["favorites", "/profile?tab=favorites"],
    ["overview", "/profile"]
  ] as const) {
    clickHost(
      findHost(
        tabStripElement(navigation, "mobile"),
        hookFree,
        (element) => element.props["data-profile-tab"] === tab,
        `the ${tab} control`
      ),
      `${tab} control`
    );
    assert.equal(pushed.at(-1), href, `the ${tab} control must write its own URL`);
  }
});

test("the desktop sidebar keeps the lg-only copy of the same tab list", () => {
  const { navigation } = mountProfileNavigation("orders");
  const hookFree = [profileTabNav()];
  const sidebar = findHost(
    tabStripElement(navigation, "sidebar"),
    hookFree,
    (element) => element.props["data-profile-tab-nav"] === "sidebar",
    "the sidebar tab navigation"
  );
  const classes = classTokens(sidebar);
  assert.ok(
    classes.includes("hidden") && classes.includes("lg:block"),
    "the sidebar nav is the desktop-only instance"
  );
  const orders = findHost(
    tabStripElement(navigation, "sidebar"),
    hookFree,
    (element) => element.props["data-profile-tab"] === "orders",
    "the sidebar orders control"
  );
  assert.equal(orders.props["aria-current"], "page");
});

function galleryEntry(index: number): GalleryEntry {
  const design = mockDesignOptions[index] as PublicDesignV1;
  return {
    design: { ...design, revision: 7 } as PublicDesignV1,
    status: index === 0 ? "SAVED" : "DRAFT",
    updatedAt: "2026-09-30T08:12:00.000Z"
  };
}

function galleryCardProps(entry: GalleryEntry, overrides: HostProps = {}) {
  const calls: string[] = [];
  const props: HostProps = {
    entry,
    isFeatured: false,
    busy: false,
    deleteArmed: false,
    menuOpen: false,
    onExport: () => calls.push("export"),
    onClone: () => calls.push("clone"),
    onArmDelete: () => calls.push("arm"),
    onConfirmDelete: () => calls.push("confirm"),
    onToggleMenu: () => calls.push("menu"),
    ...overrides
  };
  return { props, calls };
}

function isOverlay(element: HostElement): boolean {
  return typeof element.props["data-gallery-overlay"] === "string";
}

function isDeleteAction(element: HostElement): boolean {
  return element.props["data-gallery-action"] === "delete";
}

test("non-featured gallery overlays stay operable from the keyboard", () => {
  const Card = galleryCard();
  const hookFree = [Card];
  const overlay = findHost(
    mount(Card, galleryCardProps(galleryEntry(1)).props),
    hookFree,
    isOverlay,
    "the desktop action overlay"
  );
  const classes = classTokens(overlay);
  assert.ok(classes.includes("translate-y-full") && classes.includes("opacity-0"), "the overlay starts hidden");
  assert.ok(classes.includes("group-hover:opacity-100"), "hover still reveals the actions");
  assert.ok(
    classes.includes("group-focus-within:translate-y-0") && classes.includes("group-focus-within:opacity-100"),
    "keyboard focus inside the card must reveal the actions, otherwise Tab lands on invisible controls"
  );
  assert.ok(
    classes.includes("focus-within:translate-y-0") && classes.includes("focus-within:opacity-100"),
    "focusing an action itself must keep it visible"
  );

  const featuredOverlay = findHost(
    mount(Card, galleryCardProps(galleryEntry(0), { isFeatured: true }).props),
    hookFree,
    isOverlay,
    "the featured desktop action overlay"
  );
  assert.ok(!classTokens(featuredOverlay).includes("opacity-0"), "the featured overlay stays visible");
});

test("featured gallery cards keep the same delete action as every other card", () => {
  const Card = galleryCard();
  const hookFree = [Card];
  for (const isFeatured of [true, false]) {
    const entry = galleryEntry(isFeatured ? 0 : 1);
    const { props, calls } = galleryCardProps(entry, { isFeatured });
    const deleteActions = findHosts(mount(Card, props), hookFree, isDeleteAction);
    assert.ok(deleteActions.length > 0, `a ${isFeatured ? "featured" : "regular"} card must offer delete`);
    for (const action of deleteActions) {
      assert.equal(action.props.disabled, false, "delete stays enabled while the card is idle");
      clickHost(action, "delete action");
    }
    assert.ok(
      calls.length === deleteActions.length && calls.every((call) => call === "arm"),
      `a ${isFeatured ? "featured" : "regular"} card must arm delete, never delete outright`
    );
  }
});

test("deleting a featured design still asks for a second, explicit confirmation", () => {
  const Card = galleryCard();
  const hookFree = [Card];
  const entry = galleryEntry(0);
  const armed = galleryCardProps(entry, { isFeatured: true, deleteArmed: true });
  const confirmations = findHosts(
    mount(Card, armed.props),
    hookFree,
    (element) => element.props["data-gallery-action"] === "delete-confirm"
  );
  assert.ok(confirmations.length > 0, "an armed featured card must expose the explicit confirmation");
  for (const confirmation of confirmations) {
    clickHost(confirmation, "delete confirmation");
  }
  assert.equal(
    armed.calls.filter((call) => call === "confirm").length,
    confirmations.length,
    "the armed click performs the delete exactly once per control"
  );
  assert.equal(armed.calls.filter((call) => call === "arm").length, 0, "an armed control must not re-arm");
});

test("busy gallery cards disable every owner action, featured included", () => {
  const Card = galleryCard();
  const hookFree = [Card];
  for (const isFeatured of [true, false]) {
    const { props } = galleryCardProps(galleryEntry(isFeatured ? 0 : 1), { isFeatured, busy: true });
    const actions = findHosts(
      mount(Card, props),
      hookFree,
      (element) => element.type === "button" && typeof element.props["data-gallery-action"] === "string"
    );
    assert.ok(actions.length > 0, `a busy ${isFeatured ? "featured" : "regular"} card must still render its actions`);
    for (const action of actions) {
      if (action.props["data-gallery-action"] === "menu") continue;
      assert.equal(action.props.disabled, true, `${String(action.props["data-gallery-action"])} must be disabled while busy`);
    }
  }
});

test("gallery clone and delete stay revision aware", async () => {
  const deleteEntry = requireExport(
    galleryPage.deleteGalleryEntry as
      | ((
          entry: GalleryEntry,
          deps: { deleteDesign: (designId: string, expectedRevision: number) => Promise<unknown>; refresh: () => Promise<void> }
        ) => Promise<string>)
      | undefined,
    "deleteGalleryEntry"
  );
  const cloneEntry = requireExport(
    galleryPage.cloneGalleryEntry as
      | ((
          entry: GalleryEntry,
          deps: { cloneDesign: (designId: string, expectedRevision: number) => Promise<unknown>; refresh: () => Promise<void> }
        ) => Promise<string>)
      | undefined,
    "cloneGalleryEntry"
  );
  const entry = galleryEntry(0);
  const deleteCalls: Array<[string, number]> = [];
  const cloneCalls: Array<[string, number]> = [];
  let refreshes = 0;
  const refresh = async () => {
    refreshes += 1;
  };
  const deleteMessage = await deleteEntry(entry, {
    deleteDesign: async (designId, expectedRevision) => {
      deleteCalls.push([designId, expectedRevision]);
    },
    refresh
  });
  const cloneMessage = await cloneEntry(entry, {
    cloneDesign: async (designId, expectedRevision) => {
      cloneCalls.push([designId, expectedRevision]);
    },
    refresh
  });
  assert.deepEqual(deleteCalls, [[entry.design.designId, 7]], "delete must send the current revision");
  assert.deepEqual(cloneCalls, [[entry.design.designId, 7]], "clone must send the current revision");
  assert.equal(refreshes, 2, "each successful action reloads the list once");
  assert.match(deleteMessage, /已删除/);
  assert.match(cloneMessage, /已复制/);
});
