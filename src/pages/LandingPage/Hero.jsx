import React, { useState } from 'react'
import { meltAssets } from '../../assets/assets'

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import HeroChocolates from './HeroChocolates'
import FlavorCards from './FlavorCards'
import useIsMobile from '../../hooks/useIsMobile'

gsap.registerPlugin(ScrollTrigger);

const Hero = () => {

  const [activeFlavor, setActiveFlavor] = useState(null);
  const isMobile = useIsMobile();

  useGSAP(() => {
    if (isMobile) {
      // Mobile: animate each flavor card in from below as user scrolls
      const cards = document.querySelectorAll(".card");
      cards.forEach((card, i) => {
        gsap.from(card, {
          y: 60,
          opacity: 0,
          duration: 0.7,
          delay: i * 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: card,
            start: "top 90%",
            toggleActions: "play none none none",
          },
        });
      });
      return;
    }

    const pairs = [
      {
        choco: document.querySelector(".caramel-choco"),
        card: document.querySelector(".caramel-card"),
      },
      {
        choco: document.querySelector(".cocoa-choco"),
        card: document.querySelector(".cocoa-card"),
      },
      {
        choco: document.querySelector(".orange-choco"),
        card: document.querySelector(".orange-card"),
      },
      {
        choco: document.querySelector(".almond-choco"),
        card: document.querySelector(".almond-card"),
      },
    ];

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: ".choco-section",
        start: "top top",
        end: "74% center",
        scrub: true,
        invalidateOnRefresh: true,
      },
    });

    pairs.forEach(({ choco, card }) => {
      tl.to(
        choco,
        {
          x: () => {
            if (!choco || !card) return 0;
            const c = choco.getBoundingClientRect();
            const t = card.getBoundingClientRect();
            if (!c.width || !t.width) return 0;
            return t.left + t.width / 2 - (c.left + c.width / 2);
          },
          y: () => {
            if (!choco || !card) return 0;
            const c = choco.getBoundingClientRect();
            const t = card.getBoundingClientRect();
            if (!c.height || !t.height) return 0;
            return t.top + t.height / 2 - (c.top + c.height * 0.68);
          },
          scale: 0.6,
          ease: "none",
        },
        0
      );
    });
  }, { dependencies: [isMobile] });

  return (
    <section className='choco-section inner-container'>
      <HeroChocolates activeFlavor={activeFlavor} />
      <FlavorCards setActiveFlavor={setActiveFlavor} />
    </section>
  )
}

export default Hero