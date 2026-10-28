import React from 'react'

/**
 * Base skeleton block: a theme-aware pulsing placeholder.
 *
 * `variant` controls the corner shape so callers can express intent:
 *   - "rect" (default) / "text" → rounded corners
 *   - "circular"                → full circle (avatars, dots, icon buttons)
 *
 * The shape class is applied BEFORE `className`, so a caller can still pass
 * its own `rounded-*` to override. Marked aria-hidden — skeletons are purely
 * decorative; the loading state is announced via aria-busy on the container.
 */
const Skeleton = ({ variant = "rect", className = "" }) => {
  const shape = variant === "circular" ? "rounded-full" : "rounded"
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-surface-muted ${shape} ${className}`}
    />
  )
}

export default Skeleton