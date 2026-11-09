import { lazy, memo, Suspense } from "react";

import { RenderErrorBoundary } from "../RenderErrorBoundary";

const MathTypeset = lazy(() => import("./MathTypeset"));

/**
 * One formula from `remark-math`. Shows its TeX until KaTeX loads, and keeps
 * showing it when KaTeX cannot parse it, such as mid-stream.
 */
export const MarkdownMath = memo(function MarkdownMath(props: { tex: string; display: boolean }) {
  const tex = props.tex.trim();
  const fallback = (
    <span className="whitespace-pre-wrap">{props.display ? `$$\n${tex}\n$$` : `$${tex}$`}</span>
  );
  return (
    <span
      className={
        props.display
          ? "chat-markdown-math-display my-[0.65rem] block max-w-full overflow-x-auto overflow-y-hidden"
          : "inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle whitespace-nowrap"
      }
      data-markdown-math={props.display ? "display" : "inline"}
    >
      <RenderErrorBoundary resetKeys={[tex]} fallback={fallback}>
        <Suspense fallback={fallback}>
          <MathTypeset tex={tex} display={props.display} fallback={fallback} />
        </Suspense>
      </RenderErrorBoundary>
    </span>
  );
});
