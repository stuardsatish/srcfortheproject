import React, { useRef } from 'react'
import { meltAssets } from '../../assets/assets'

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import useIsMobile from '../../hooks/useIsMobile'

gsap.registerPlugin(ScrollTrigger, SplitText);

const Taste = () => {

    const tasteRef = useRef(null);
    const isMobile = useIsMobile();

    useGSAP(() => {

        if (isMobile) {
            // Mobile: simple fade-up animations for heading and text labels
            const h2El = tasteRef.current?.querySelector('h2');
            if (h2El) {
                gsap.from(h2El, {
                    opacity: 0,
                    y: 30,
                    duration: 0.8,
                    ease: "power3.out",
                    scrollTrigger: {
                        trigger: tasteRef.current,
                        start: 'top 80%',
                        toggleActions: "play none none none",
                    }
                });
            }

            // Animate bite image in
            gsap.from(".img-1", {
                opacity: 0,
                scale: 0.85,
                rotate: -5,
                duration: 0.9,
                ease: "power3.out",
                scrollTrigger: {
                    trigger: tasteRef.current,
                    start: 'top 75%',
                    toggleActions: "play none none none",
                }
            });

            // Animate taste text labels staggered
            const tasteTexts = tasteRef.current?.querySelectorAll('.taste-text');
            if (tasteTexts?.length) {
                gsap.from(tasteTexts, {
                    opacity: 0,
                    y: 20,
                    duration: 0.6,
                    stagger: 0.15,
                    ease: "power2.out",
                    scrollTrigger: {
                        trigger: tasteRef.current,
                        start: 'top 70%',
                        toggleActions: "play none none none",
                    }
                });
            }
            return;
        }

        SplitText.create("h2", {
            type: "chars",
            onSplit(self) {
                gsap.from(self.chars, {
                    scale: 1.3,
                    opacity: 0,
                    stagger: 0.08,
                    ease: "power3.out",
                    scrollTrigger: {
                        trigger: tasteRef.current,
                        start: 'top bottom',
                        end: 'center center',
                        scrub: 1,
                    }
                })
            }
        });

        gsap.set(".img-1", { visibility: "visible" });
        gsap.set(".img-2", { visibility: "hidden" });
        gsap.set(".img-3", { visibility: "hidden" });
        gsap.set(".img-4", { visibility: "hidden" });

        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: tasteRef.current,
                start: "top top",
                end: "+=1050%",
                scrub: 1,
                pin: true,
                anticipatePin: 1,
            },
        });

        const split1 = new SplitText(".text-1", { type: "chars" });
        const split2 = new SplitText(".text-2", { type: "chars" });
        const split3 = new SplitText(".text-3", { type: "chars" });
        const split4 = new SplitText(".text-4", { type: "chars" });

        // Arrow animation
        const arrows = gsap.utils.toArray(
            tasteRef.current.querySelectorAll(".arrow-path")
        );

        arrows.forEach((path) => {
            const length = path.getTotalLength();
            gsap.set(path, {
                strokeDasharray: length,
                strokeDashoffset: length,
            });
        });

        tl.to(".arrow-1", {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power1.inOut",
        });

        tl.to(".arrow-1", {
            fill: "#0D1927",
            duration: 0.2,
        }, "<+=1.0");

        tl.from(split1.chars, {
            visibility: "hidden",
            stagger: { each: 0.08, ease: "power1.out" },
            duration: 0.6,
        }, ">+=0.1");

        // Crunchy
        tl.to(".img-1", { visibility: "hidden" });
        tl.to(".img-2", { visibility: "visible" }, "<");

        tl.to(".arrow-2", {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power1.inOut",
        }, "<+=0.3");

        tl.to(".arrow-2", {
            fill: "#0D1927",
            duration: 0.2,
        }, "<+=1.0");

        tl.from(split2.chars, {
            visibility: "hidden",
            stagger: { each: 0.08, ease: "power1.out" },
            duration: 0.6,
        }, ">+=0.1");

        // Satisfying
        tl.to(".img-2", { visibility: "hidden" });
        tl.to(".img-3", { visibility: "visible" }, "<");

        tl.to(".arrow-3", {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power1.inOut",
        }, "<+=0.3");

        tl.to(".arrow-3", {
            fill: "#0D1927",
            duration: 0.2,
        }, "<+=1.0");

        tl.from(split3.chars, {
            visibility: "hidden",
            stagger: { each: 0.08, ease: "power1.out" },
            duration: 0.6,
        }, ">+=0.1");

        // Balanced
        tl.to(".img-3", { visibility: "hidden" });
        tl.to(".img-4", { visibility: "visible" }, "<");

        tl.to(".arrow-4", {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power1.inOut",
        }, "<+=0.3");

        tl.to(".arrow-4", {
            fill: "#0D1927",
            duration: 0.2,
        }, "<+=1.0");

        tl.from(split4.chars, {
            visibility: "hidden",
            stagger: { each: 0.08, ease: "power1.out" },
            duration: 0.6,
        }, ">+=0.1");

        // Hold before unpin
        tl.to({}, { duration: 0.8 });

    }, { scope: tasteRef, dependencies: [isMobile] })

    return (
        <section ref={tasteRef} className='text-center h-screen flex flex-col pt-24 md:pt-28 pb-8'>
            <h2 className='shrink-0 text-5xl md:text-7xl font-extrabold leading-none'>Feel the Melt</h2>
            <div className='flex flex-1 min-h-0 justify-center items-center relative scale-[0.62]'>
                <div className="relative">
                    <img src={meltAssets.bite} alt="Caramel" className='img-1 max-w-44 md:max-w-68 transform rotate-55 z-1' />
                    <div className='absolute -top-20 md:top-50 right-2 md:-right-100 flex items-end gap-2 md:gap-4'>
                        <svg width="118" height="39" viewBox="0 0 118 39" fill="none" xmlns="http://www.w3.org/2000/svg" className="hidden md:block">
                            <path className="arrow-path arrow-1"
                                d="M0.5 11.2 C6.6 21 34.5 32.1 54 32.6 C75.1 33.3 86.9 29.8 110.3 16 C110.1 17.6 109.8 19 109.8 20.2 C109.7 21.6 109.6 23.1 109.8 24.4 C109.9 24.9 110.6 25.5 111.1 25.5 C111.6 25.6 112.4 24.9 112.5 24.5 C113.6 20.5 114.5 16.5 115.5 12.3 C115.8 11 115.2 10.1 113.8 9.8 C108.4 9 102.9 8.2 97.4 7.5 C96.1 7.4 94.7 7.8 93.1 8 C94.7 11.3 97.6 10.7 99.8 11.3 C102.1 12.1 104.6 12.4 107.5 13.1 C101.2 18.3 94.6 21.8 87.5 24.3 C61.5 33.6 36.5 30.5 12.4 17.9 C9.2 16.3 6.3 14.3 3.3 12.5 C2.3 12.2 1.5 11.9 0.5 11.2Z"
                                fill="none"
                                stroke="#2C2C2C"
                                strokeWidth="2.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                        <span className='taste-text text-1 font-accent font-bold tracking-tight text-2xl md:text-[40px] pb-5'>Smooth</span>
                    </div>
                </div>
                <div className=" absolute z-0">
                    <img src={meltAssets.bite_1} alt="Caramel" className='img-2 invisible md:visible max-w-44 md:max-w-68 transform rotate-55' />
                    <div className='absolute -top-20 md:top-10 left-2 md:-left-35 flex items-end gap-4 md:gap-8'>
                        <span className='taste-text text-2 font-accent font-bold tracking-tight text-2xl md:text-[40px]'>Crunchy</span>
                        <svg width="118" height="39" className='hidden md:block rotate-195' viewBox="0 0 118 39" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path className="arrow-path arrow-2"
                                d="M0.5 11.2 C6.6 21 34.5 32.1 54 32.6 C75.1 33.3 86.9 29.8 110.3 16 C110.1 17.6 109.8 19 109.8 20.2 C109.7 21.6 109.6 23.1 109.8 24.4 C109.9 24.9 110.6 25.5 111.1 25.5 C111.6 25.6 112.4 24.9 112.5 24.5 C113.6 20.5 114.5 16.5 115.5 12.3 C115.8 11 115.2 10.1 113.8 9.8 C108.4 9 102.9 8.2 97.4 7.5 C96.1 7.4 94.7 7.8 93.1 8 C94.7 11.3 97.6 10.7 99.8 11.3 C102.1 12.1 104.6 12.4 107.5 13.1 C101.2 18.3 94.6 21.8 87.5 24.3 C61.5 33.6 36.5 30.5 12.4 17.9 C9.2 16.3 6.3 14.3 3.3 12.5 C2.3 12.2 1.5 11.9 0.5 11.2Z"
                                fill="none"
                                stroke="#2C2C2C"
                                strokeWidth="2.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
                <div className="absolute -z-1">
                    <img src={meltAssets.bite_2} alt="Caramel" className='img-3 invisible md:visible max-w-44 md:max-w-68 transform rotate-55' />
                    <div className='absolute top-[360px] md:top-112 right-2 md:right-auto md:left-25 flex items-start gap-2 md:gap-3'>
                        <svg width="113" height="84" viewBox="0 0 113 84" fill="none" xmlns="http://www.w3.org/2000/svg" className="hidden md:block">
                            <path className="arrow-path arrow-3"
                                d="M0 23.5 C9.8 17.3 40.1 19.9 57.9 28 C77.1 36.7 86.2 45 101.1 67.7 C101.7 66.1 102 64.8 102.5 63.7 C103.1 62.4 103.6 61 104.4 59.8 C104.6 59.5 105.7 59.3 106.1 59.4 C106.6 59.6 107 60.6 106.9 61 C106.1 65.1 105.2 69.1 104.3 73.2 C103.9 74.6 103 75.1 101.6 74.8 C96.4 73.1 91.1 71.4 85.8 69.6 C84.7 69.2 83.6 68.1 82.2 67.3 C85.1 65 87.4 66.9 89.7 67.2 C92.1 67.6 94.5 68.3 97.4 69 C94 61.6 89.6 55.5 84.4 50.1 C65.1 30.4 41.2 22.2 14.1 22.9 C10.5 23 7 23.5 3.5 23.7 C2.5 23.6 1.6 23.5 0 23.5Z"
                                fill="none"
                                stroke="#2C2C2C"
                                strokeWidth="2.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                        <span className='taste-text text-3 font-accent font-bold tracking-tight text-2xl md:text-[40px] pt-8 md:pt-16 whitespace-nowrap'>Satisfying</span>
                    </div>
                </div>
                <div className="absolute -z-2">
                    <img src={meltAssets.bite_3} alt="Caramel" className='img-4 invisible md:visible max-w-44 md:max-w-68 transform rotate-55' />
                    <div className='absolute top-[360px] md:top-86 left-2 md:-left-105 flex items-end gap-4 md:gap-8'>
                        <span className='taste-text text-4 font-accent font-bold tracking-tight text-2xl md:text-[40px] pb-3 md:pb-6'>Balanced</span>
                        <svg width="113" height="84" className='hidden md:block rotate-150' viewBox="0 0 113 84" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path className="arrow-path arrow-4"
                                d="M0 23.5 C9.8 17.3 40.1 19.9 57.9 28 C77.1 36.7 86.2 45 101.1 67.7 C101.7 66.1 102 64.8 102.5 63.7 C103.1 62.4 103.6 61 104.4 59.8 C104.6 59.5 105.7 59.3 106.1 59.4 C106.6 59.6 107 60.6 106.9 61 C106.1 65.1 105.2 69.1 104.3 73.2 C103.9 74.6 103 75.1 101.6 74.8 C96.4 73.1 91.1 71.4 85.8 69.6 C84.7 69.2 83.6 68.1 82.2 67.3 C85.1 65 87.4 66.9 89.7 67.2 C92.1 67.6 94.5 68.3 97.4 69 C94 61.6 89.6 55.5 84.4 50.1 C65.1 30.4 41.2 22.2 14.1 22.9 C10.5 23 7 23.5 3.5 23.7 C2.5 23.6 1.6 23.5 0 23.5Z"
                                fill="none"
                                stroke="#2C2C2C"
                                strokeWidth="2.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </div>
                </div>
            </div>
        </section>
    )
}

export default Taste