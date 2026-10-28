import React from "react";
import Skeleton from "../../components/Common/Skeleton";

export const ProductCardSkeleton = () => {
  return (
    <div className="w-full h-full group">
      <div className="h-[340px] w-full bg-surface relative flex flex-col rounded-2xl overflow-hidden shadow-sm border border-border-subtle">

        {/* Wishlist Button Placeholder */}
        <div className="absolute top-4 right-4 z-10">
          <Skeleton variant="circular" className="w-9 h-9" />
        </div>

        {/* Image Placeholder */}
        <div className="h-40 w-full p-4 flex items-center justify-center bg-surface-muted">
          <Skeleton className="h-full w-full max-w-[120px]" />
        </div>

        {/* Text Content Placeholder */}
        <div className="p-3 flex flex-col flex-1 bg-surface relative pt-5">
          {/* Price Label Placeholder */}
          <div className="absolute right-3 -top-5">
            <Skeleton className="w-16 h-7 rounded-full bg-border-strong" />
          </div>

          {/* Category Placeholder */}
          <Skeleton variant="text" className="w-20 h-3 mb-2" />

          {/* Title Placeholder */}
          <Skeleton variant="text" className="w-full h-5 mb-1" />
          <Skeleton variant="text" className="w-2/3 h-5 mb-3" />

          {/* Rating & Stock Placeholder */}
          <div className="flex items-center justify-between mt-auto">
            <div className="flex gap-1">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} variant="circular" className="w-3 h-3" />
              ))}
            </div>
            <Skeleton className="w-16 h-4 rounded-md" />
          </div>
        </div>

        {/* Button Placeholder */}
        <div className="px-3 pb-3 bg-surface">
          <Skeleton className="w-full h-10 rounded-xl" />
        </div>

      </div>
    </div>
  );
};