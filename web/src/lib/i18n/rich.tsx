import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * Minimal rich text: `<b>bold</b>`, `<code>x</code>`, `<a>link</a>` (no nesting). Each tag maps to either a
 * render function (client components) or a serializable spec (usable from server components via <T>).
 */
export type TagSpec = string | { href: string; className?: string };
export type TagRenderer = (chunk: string, key: number) => ReactNode;
export type RichTags = Record<string, TagSpec | TagRenderer>;

const INLINE = new Set(["b", "strong", "code", "em", "i", "span"]);
const TAG_RE = /<(\w+)>([\s\S]*?)<\/\1>/g;

function renderSpec(tag: string, spec: TagSpec, chunk: string, key: number): ReactNode {
  if (typeof spec === "string") {
    const El = (INLINE.has(tag) ? tag : "span") as "span";
    return (
      <El key={key} className={spec || undefined}>
        {chunk}
      </El>
    );
  }
  if (spec.href.startsWith("/")) {
    return (
      <Link key={key} href={spec.href} className={spec.className}>
        {chunk}
      </Link>
    );
  }
  return (
    <a key={key} href={spec.href} target="_blank" rel="noopener noreferrer" className={spec.className}>
      {chunk}
    </a>
  );
}

export function renderRich(text: string, tags: RichTags = {}): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const [whole, tag, chunk] = m;
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${i++}`}>{text.slice(last, at)}</Fragment>);
    const spec = tags[tag];
    if (typeof spec === "function") out.push(<Fragment key={`r${i++}`}>{spec(chunk, i)}</Fragment>);
    else if (spec !== undefined) out.push(renderSpec(tag, spec, chunk, i++));
    else out.push(<Fragment key={`p${i++}`}>{chunk}</Fragment>);
    last = at + whole.length;
  }
  if (last < text.length) out.push(<Fragment key={`t${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

/** Strip tags for plain-text use (aria-labels, share text). */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, "$2");
}
