import React, { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import useIsMobile from "../../hooks/useIsMobile";

gsap.registerPlugin(ScrollTrigger);

const Quality = () => {
  const sectionRef = useRef(null);
  const cardsRef = useRef([]);
  const isMobile = useIsMobile();

  useGSAP(() => {
    if (isMobile) {
      // Mobile: animate heading and cards in with fade-up on scroll
      const h2El = sectionRef.current?.querySelector('h2');
      const desc = sectionRef.current?.querySelector('div > div.max-w-full');
      if (h2El) {
        gsap.from(h2El, {
          opacity: 0,
          y: 40,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          }
        });
      }
      if (desc) {
        gsap.from(desc, {
          opacity: 0,
          y: 25,
          duration: 0.7,
          delay: 0.15,
          ease: "power2.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          }
        });
      }
      // Animate each card with stagger
      cardsRef.current.forEach((card, i) => {
        if (!card) return;
        gsap.from(card, {
          opacity: 0,
          y: 50,
          rotate: i % 2 === 0 ? -6 : 6,
          duration: 0.7,
          delay: i * 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: card,
            start: "top 85%",
            toggleActions: "play none none none",
          }
        });
      });
      return;
    }

    // set initial state individually
    cardsRef.current.forEach((card, i) => {
      gsap.set(card, {
        y: "180%",
        rotate: i % 2 === 0 ? -10 : 10,
      });
    });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: "top top",
        end: "+=300%",
        scrub: 1,
        pin: true,
        anticipatePin: 1,
      },
    });

    tl.to(cardsRef.current, {
      y: 0,
      rotate: 0,
      duration: 2,
      stagger: 1,
      ease: "power2.out",
    });
  }, { scope: sectionRef, dependencies: [isMobile] });

  return (
    <section ref={sectionRef} className="inner-container pt-16 md:pt-30 pb-20 md:pb-40">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-20">
        {/* LEFT CONTENT */}
        <div className="md:col-span-7 h-full flex flex-col justify-between gap-6">
          <h2 className="max-w-full md:max-w-175 leading-tight md:leading-20">
            What goes into every bar of{" "}
            <span className="text-orange">MELT</span>
          </h2>
          <div className="max-w-full md:max-w-115 leading-6 font-medium text-base">
            Every bar is a result of careful sourcing, precise timing, and
            countless taste tests — all to make sure each bite feels intentional.
          </div>
        </div>

        {/* RIGHT CARDS */}
        <div className="md:col-span-5 relative flex flex-col gap-4 h-auto md:block md:h-130">
          <div
            ref={(el) => (cardsRef.current[0] = el)}
            className="card bg-blue text-white rounded-3xl max-w-full md:max-w-115 w-full p-6 md:p-10 min-h-48 md:min-h-112 flex flex-col justify-between md:ml-auto"
          >
            <div>
              <div className="text-6xl md:text-[7.5vw] font-semibold leading-tight md:leading-40">200+</div>
              <div className="text-xl md:text-3xl font-semibold">Taste Iterations</div>
            </div>
            <div className="text-sm md:text-base">Refined until the flavour feels just right.</div>
          </div>

          <div
            ref={(el) => (cardsRef.current[1] = el)}
            className="card bg-melt-yellow text-white rounded-3xl max-w-full md:max-w-115 w-full p-6 md:p-10 min-h-48 md:min-h-112 flex flex-col justify-between md:absolute md:top-16 md:right-0"
          >
            <div>
              <div className="text-6xl md:text-[7.5vw] font-semibold leading-tight md:leading-40">30+</div>
              <div className="text-xl md:text-3xl font-semibold">Test Batches</div>
            </div>
            <div className="text-sm md:text-base">Small batches. Big attention to detail.</div>
          </div>

          <div
            ref={(el) => (cardsRef.current[2] = el)}
            className="card bg-green text-white rounded-3xl max-w-full md:max-w-115 w-full p-6 md:p-10 min-h-48 md:min-h-112 flex flex-col justify-between md:absolute md:top-32 md:right-0"
          >
            <div>
              <div className="text-6xl md:text-[7.5vw] font-semibold leading-tight md:leading-40">100%</div>
              <div className="text-xl md:text-3xl font-semibold">Natural Ingredients</div>
            </div>
            <div className="text-sm md:text-base">No shortcuts. No compromises.</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Quality;