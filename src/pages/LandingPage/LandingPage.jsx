import React, { useState, useEffect } from 'react'
import Hero from './Hero'
import Taste from './Taste'
import Quality from './Quality'
import Parallax from './Parallax'
import Merchandising from './Merchandising'
import SmoothScroll from './SmoothScroll'
import { meltAssets } from '../../assets/assets'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger);

const LandingPage = () => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const keyImages = [
      meltAssets.crispy_caramel,
      meltAssets.crispy_caramel_1,
      meltAssets.dark_cocoa,
      meltAssets.dark_cocoa_1,
      meltAssets.orange_zest_milk,
      meltAssets.orange_zest_milk_1,
      meltAssets.almond_crunch,
      meltAssets.almond_crunch_1,
      meltAssets.stamp,
      meltAssets.bite,
      meltAssets.bite_1,
      meltAssets.bite_2,
      meltAssets.bite_3,
      meltAssets.choclate_bg_2,
    ];

    const preloadImages = keyImages.map((src) => {
      return new Promise((resolve) => {
        if (!src) return resolve(true);
        const img = new Image();
        img.src = src;
        if (img.complete) {
          resolve(true);
        } else {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(true);
        }
      });
    });

    const fontPromise = document.fonts ? document.fonts.ready : Promise.resolve();
    const maxTimeout = new Promise((resolve) => setTimeout(resolve, 1500));

    Promise.race([
      Promise.all([...preloadImages, fontPromise]),
      maxTimeout
    ]).then(() => {
      if (isMounted) {
        setIsReady(true);
        setTimeout(() => {
          ScrollTrigger.refresh();
        }, 150);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="melt-theme relative min-h-screen">
      {/* Loading Overlay to prevent unrendered/broken UI from showing */}
      {!isReady && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#FAF7F2] transition-opacity duration-300">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[#8B4513]/20 border-t-[#8B4513] rounded-full animate-spin"></div>
            <p className="font-accent text-[#8B4513] text-lg tracking-widest font-semibold animate-pulse">
              LOADING MELT...
            </p>
          </div>
        </div>
      )}

      {/* Main Page Content */}
      <div className={isReady ? "opacity-100 transition-opacity duration-500" : "opacity-0"}>
        <SmoothScroll>
          <Hero />
          <Taste />
          <Quality />
          {/* Task 2.3 — live category grid / bestsellers / deals. Sits after the
              brand sections so the storytelling still leads, but a visitor
              now reaches real products without using the nav bar. */}
          <Merchandising />
          <Parallax />
        </SmoothScroll>
      </div>
    </div>
  )
}

export default LandingPage