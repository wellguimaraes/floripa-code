import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];
// Bubbles clip to a line or two, so only inline formatting renders; blocks and links
// fold into their text. Links stay text because agents link local files the browser can't open.
const INLINE_ELEMENTS = ["p", "strong", "em", "del", "code"];
const inlineCode: Components["code"] = ({ children }) => (
  <code className="rounded bg-current/10 px-1 font-mono">{children}</code>
);
const COMPONENTS: Components = {
  p: ({ children }) => <>{children} </>,
  code: inlineCode,
};

// A whole reply keeps its paragraphs, lists, quotes and code blocks, sized for a bubble.
// Headings read as bold lines and tables fold into their text.
const BLOCK_ELEMENTS = [
  ...INLINE_ELEMENTS,
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];
const heading: Components["h1"] = ({ children }) => <p className="font-semibold">{children}</p>;
const BLOCK_COMPONENTS: Components = {
  code: inlineCode,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded bg-current/10 p-2 font-mono [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-current/30 border-l-2 pl-2 opacity-80">{children}</blockquote>
  ),
  hr: () => <hr className="border-current/20" />,
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
};

/**
 * A bubble's text as markdown. Inline by default, inside whatever clamps or truncates it;
 * `block` renders a whole message, blocks spaced apart.
 */
export const BubbleMarkdown = memo(function BubbleMarkdown({
  text,
  block = false,
}: {
  readonly text: string;
  readonly block?: boolean;
}) {
  const markdown = (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      allowedElements={block ? BLOCK_ELEMENTS : INLINE_ELEMENTS}
      unwrapDisallowed
      components={block ? BLOCK_COMPONENTS : COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
  return block ? <div className="flex flex-col gap-1.5 break-words">{markdown}</div> : markdown;
});
