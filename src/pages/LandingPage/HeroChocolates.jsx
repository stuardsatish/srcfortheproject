import React, { useRef } from 'react'
import { meltAssets } from '../../assets/assets'

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { SplitText } from "gsap/SplitText";
import useIsMobile from '../../hooks/useIsMobile';

gsap.registerPlugin(SplitText);

const HeroChocolates = ({ activeFlavor }) => {
    const containerRef = useRef(null);
    const isMobile = useIsMobile();

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

        // Chocolate images slide up on load
        tl.from('.caramel-choco', { y: isMobile ? "40%" : "60%", scale: 0.8, duration: 1 }, 0)
            .from('.cocoa-choco', { y: isMobile ? "30%" : "40%", scale: 0.8, duration: 1 }, 0)
            .from('.orange-choco', { y: isMobile ? "30%" : "40%", scale: 0.8, duration: 1 }, 0)
            .from('.almond-choco', { y: isMobile ? "40%" : "60%", scale: 0.8, duration: 1 }, 0);

        // Stamp pop-in
        tl.from('.stamp', { scale: 2, opacity: 0, duration: 0.4, ease: "back.out(1.7)" }, 0.8);

        // Heading char-by-char reveal
        const h1El = containerRef.current?.querySelector('h1');
        const h2El = containerRef.current?.querySelector('h2');

        if (h1El) {
            SplitText.create(h1El, {
                type: "chars",
                onSplit(self) {
                    tl.from(self.chars, {
                        scale: 1.3,
                        opacity: 0,
                        stagger: isMobile ? 0.05 : 0.08,
                        duration: 0.5,
                        ease: "power3.out",
                    }, 0.1);
                }
            });
        }

        if (h2El) {
            tl.from(h2El, { opacity: 0, y: 10, duration: 0.8 }, 0.4);
        }

    }, { scope: containerRef })

    return (
        <div ref={containerRef}>
            <div className="text-center text-brown pt-24 pb-12 md:pt-20 md:pb-24">
                <h1 className='text-4xl md:text-8xl font-bold leading-tight md:leading-28'>Four <span className='text-orange'>Flavors.</span></h1>
                <h2 className='font-medium text-xl md:text-[40px]'>One Perfect Melt.</h2>
            </div>
            <div className="grid grid-cols-2 justify-items-center items-start gap-4 px-4 md:flex md:flex-nowrap md:justify-center md:gap-6 md:px-0">
                <div>
                    <img src={activeFlavor === 'caramel' ? meltAssets.crispy_caramel_1 : meltAssets.crispy_caramel} alt="Caramel" className='relative z-10 caramel-choco max-w-40 md:max-w-72.5 md:mt-18 drop-shadow-[0_10px_40px_rgba(255,107,87,0.5)]' />
                </div>
                <div>
                    <img src={activeFlavor === 'cocoa' ? meltAssets.dark_cocoa_1 : meltAssets.dark_cocoa} alt="Cocoa" className='relative z-10 cocoa-choco max-w-40 md:max-w-72.5 drop-shadow-[0_10px_40px_rgba(72,156,211,0.5)]' />
                </div>
                <div>
                    <img src={activeFlavor === 'orange' ? meltAssets.orange_zest_milk_1 : meltAssets.orange_zest_milk} alt="Orange" className='relative z-10 orange-choco max-w-40 md:max-w-72.5 drop-shadow-[0_10px_40px_rgba(253,211,38,0.5)]' />
                </div>
                <div className='relative'>
                    <img src={activeFlavor === 'almond' ? meltAssets.almond_crunch_1 : meltAssets.almond_crunch} alt="Almond" className='relative z-10 almond-choco max-w-40 md:max-w-72.5 md:mt-18 drop-shadow-[0_10px_40px_rgba(157,156,61,0.5)]' />
                    <img src={meltAssets.stamp} alt="Stamp" className='stamp absolute z-10 max-w-20 md:max-w-37.5 -top-6 md:-top-10 -left-10 md:-left-20 transform rotate-32' />
                </div>
            </div>
        </div>
    )
}

export default HeroChocolates