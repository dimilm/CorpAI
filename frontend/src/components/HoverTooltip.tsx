import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface HoverTooltipProps {
  /** Rich tooltip body shown on hover. */
  content: ReactNode;
  /** The hover target (rendered inline). */
  children: ReactNode;
  className?: string;
}

interface Anchor {
  x: number;
  y: number;
}

/** Lightweight hover tooltip rendered through a body portal with
 *  `position: fixed`, so it is never clipped by an ancestor's `overflow`
 *  (the watchlist table scrolls horizontally, which would otherwise cut a
 *  CSS `::after` tooltip). Position is read from the anchor's bounding box on
 *  enter; the tooltip is non-interactive (`pointer-events: none`). */
export function HoverTooltip({ content, children, className }: HoverTooltipProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const id = useId();

  const show = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
  };
  const hide = () => setAnchor(null);

  return (
    <span
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      aria-describedby={anchor ? id : undefined}
    >
      {children}
      {anchor &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="hover-tooltip"
            style={{ left: anchor.x, top: anchor.y }}
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
}

export default HoverTooltip;
