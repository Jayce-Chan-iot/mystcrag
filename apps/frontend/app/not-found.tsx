import { SystemState } from "../components/page-scaffold";

/**
 * Approved localized 404 copy. Kept at the route so the page wording stays the
 * reviewed "没有找到这个页面" while the frame, role and 44px action come from the
 * shared system-state primitive.
 */
const NOT_FOUND_COPY = {
  title: "没有找到这个页面",
  message: "链接可能已经失效，或者页面仍在准备中。你可以返回首页重新开始。"
} as const;

export default function NotFound() {
  return (
    <main data-star-surface="system-state">
      <SystemState
        action={{ kind: "link", label: "返回首页", href: "/" }}
        kind="not-found"
        message={NOT_FOUND_COPY.message}
        title={NOT_FOUND_COPY.title}
      />
    </main>
  );
}
