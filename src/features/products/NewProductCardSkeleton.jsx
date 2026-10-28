import React from "react";
import Skeleton from "../../components/Common/Skeleton";

/**
 * Content-aware skeleton for the desktop ProductsPage grid card
 * (`NewProductCard`): 160px image area with a badge + wishlist button,
 * then a body with a rating row, a 2-line title, a price line, a
 * stock badge + progress bar, and a full-width CTA button.
 *
 * Mirrors the real card's container (bg-surface, border-strong, rounded-xl,
 * shadow) so the swap to real data causes no layout jump.
 */
export const NewProductCardSkeleton = () => {
  return (
    <div
      className="flex flex-col bg-surface border border-[var(--color-border-strong)] rounded-xl overflow-hidden shadow-[0px_4px_12px_rgba(0,0,0,0.05)]"
      aria-hidden="true"
    >
      {/* Image area */}
      <div
        className="relative animate-pulse"
        style={{ height: "160px", background: "var(--color-surface-muted)" }}
      >
        {/* Badge placeholder (top-left) */}
        <div
          className="absolute top-2.5 left-2.5 h-4 w-14 rounded"
          style={{ background: "var(--color-border)" }}
        />
        {/* Wishlist button placeholder (top-right) */}
        <div
          className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full"
          style={{ background: "var(--color-surface)" }}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-3">
        {/* Rating row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-6" />
        </div>

        {/* Title — two lines, matching the real card's min-height */}
        <div className="flex flex-col gap-1" style={{ minHeight: "38px" }}>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>

        {/* Price line */}
        <div className="mt-2">
          <Skeleton className="h-4 w-24" />
        </div>

        {/* Stock badge + progress bar */}
        <div className="flex items-center gap-2 mt-2 mb-3">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="w-[70px] h-[5px] rounded-full" />
        </div>

        {/* CTA button */}
        <div className="mt-auto">
          <Skeleton className="w-full h-10 rounded-lg" />
        </div>
      </div>
    </div>
  );
};

export default NewProductCardSkeleton;