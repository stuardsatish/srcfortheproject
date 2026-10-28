import { useState, useEffect } from 'react';

/**
 * Returns true when viewport width ≤ 768px.
 * Used to gate desktop-only interactions (tilt, mouse-follow, heavy GSAP pinning).
 */
const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);

    // Set initial value
    setIsMobile(mq.matches);

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
};

export default useIsMobile;