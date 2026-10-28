import { useEffect } from "react";
import Lenis from "@studio-freight/lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const SmoothScroll = ({ children }) => {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      smoothWheel: true,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });

    // 🔗 keep ScrollTrigger in sync with Lenis
    lenis.on("scroll", ScrollTrigger.update);

    // Drive Lenis from GSAP's ticker. IMPORTANT: keep a stable reference so the
    // cleanup can remove the SAME function. The previous code removed
    // `lenis.raf` (a different reference), so under React StrictMode's
    // mount→unmount→mount cycle this callback stayed registered but pointed at
    // a destroyed Lenis instance — which stalled gsap.ticker and froze every
    // animation at its starting (`from`) state until a resize kicked it back.
    const update = (time) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);

    // Recalculate ScrollTrigger positions once images/fonts have settled so
    // triggers and pins are correct on a fresh load (not only after a resize).
    const refresh = () => ScrollTrigger.refresh();
    if (document.readyState === "complete") {
      refresh();
    } else {
      window.addEventListener("load", refresh);
    }

    return () => {
      window.removeEventListener("load", refresh);
      gsap.ticker.remove(update);
      lenis.off("scroll", ScrollTrigger.update);
      lenis.destroy();
    };
  }, []);

  return children;
};

export default SmoothScroll;