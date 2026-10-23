import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];
// Bubbles clip to a line or two, so only inline formatting renders; blocks and links
// fold into their text. Links stay text because agents link local files the browser can't open.
const INLINE_ELEMENTS = ["p", "strong", "em", "del", "code"];
const COMPONENTS: Components = {
  p: ({ children }) => <>{children} </>,
  code: ({ children }) => <code className="rounded bg-current/10 px-1 font-mono">{children}</code>,
};

/** A bubble's text as inline markdown, inside whatever clamps or truncates it. */
export const BubbleMarkdown = memo(function BubbleMarkdown({ text }: { readonly text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
      components={COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});
