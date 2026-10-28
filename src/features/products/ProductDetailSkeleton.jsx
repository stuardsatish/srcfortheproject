import React from "react";
import Skeleton from "../../components/Common/Skeleton";

export const ProductDetailSkeleton = () => {
  return (
    <div className="bg-background min-h-screen text-ink overflow-x-hidden p-6 lg:p-20">
      <div className="w-full max-w-[1700px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-0 items-start pt-16">

        {/* Left Info Placeholder */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:gap-10 pr-8">
          <div className="space-y-4">
            <Skeleton className="w-32 h-10" />
            <Skeleton className="w-full h-16" />
            <Skeleton className="w-24 h-6" />
          </div>

          <div className="space-y-3">
            <Skeleton className="w-20 h-3" />
            <Skeleton className="w-40 h-12" />
            <Skeleton className="w-32 h-5 rounded-full" />
          </div>

          <div className="flex gap-4">
            <Skeleton className="w-40 h-14 rounded-2xl" />
            <Skeleton className="w-14 h-14 rounded-2xl" />
          </div>

          <Skeleton className="w-full h-24" />
        </div>

        {/* Center Gallery Placeholder */}
        <div className="lg:col-span-5 flex flex-col items-center gap-8">
          <Skeleton className="w-full aspect-square max-w-[500px] rounded-3xl" />
          <div className="flex gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="w-16 h-16 rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Right Attributes Placeholder */}
        <div className="lg:col-span-3 lg:pl-12 space-y-12">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-4">
              <Skeleton className="w-24 h-3" />
              <Skeleton className="w-full h-6" />
              <Skeleton className="w-2/3 h-4" />
            </div>
          ))}
          <Skeleton className="w-full h-40 rounded-[2.5rem]" />
        </div>

      </div>
    </div>
  );
};