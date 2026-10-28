import { useEffect } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { ScrollSmoother } from "gsap/ScrollSmoother"
import SplitText from "gsap/SplitText"

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText)

export default function ProcessDetailsPage() {

    useEffect(() => {

        const ctx = gsap.context(() => {

            // HERO TEXT SPLIT ANIMATION
            const split = new SplitText("#section1 h1", {
                type: "chars"
            })

            gsap.from(split.chars, {
                yPercent: () => gsap.utils.random(-100, 100),
                rotation: () => gsap.utils.random(-30, 30),
                opacity: 0,
                ease: "back.out(1.7)",
                stagger: {
                    amount: 0.5,
                    from: "random"
                },
                duration: 1.5
            })


            // HEADPHONE INTRO ANIMATION
            gsap.from("#headphone", {
                opacity: 0,
                scale: 0,
                duration: 1,
                delay: 1,
                ease: "power2.out"
            })




            const smoother = ScrollSmoother.create({
                wrapper: "#smooth-wrapper",
                content: "#smooth-content",
                smooth: 4,
                effects: true
            })


            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: "main",
                    start: "top top",
                    end: "bottom bottom",
                    scrub: 1.5,
                }
            });

            // SECTION 2: Move to side and increase size
            tl.to("#headphone", {
                y: "100vh",
                x: "15vw",
                width: '115vw',
                rotate: 90,
                ease: "none"
            })
                // SECTION 3: Move to center (Masterbeat)
                .to("#headphone", {
                    y: "218vh",
                    x: "16vw",
                    width: '85vw',
                    rotate: 35,
                    ease: "none"
                })
                // SECTION 4: Move to left for images
                .to('#headphone', {
                    y: '308vh',
                    x: "-8vw",
                    width: '45vw',
                    rotate: 90,
                    ease: "none"
                })
                // SECTION 5: Final position and size (Top Picks)
                .to('#headphone', {
                    y: "390vh",
                    x: "-2vw",
                    width: "450px",
                    ease: "none"
                });


        })

        return () => ctx.revert()

    }, [])

    const products = [
        { name: "Dairy Milk", price: "₹4,499", img: "/audira-images/chocolate1.png" },
        { name: "Maxi Donut", price: "₹7,499", img: null },
        { name: "Kitkat Pro", price: "₹11,499", img: "/audira-images/chocolate2.png" }
    ]

    return (

        <div className="audira-theme">



            <div id="smooth-wrapper">
                <div id="smooth-content">

                    <main className="relative">

                        <img
                            id="headphone"
                            src="/audira-images/donut.png"
                            //top-[4%]  is the initial position is set to 4 for donut
                            // w-[10vw] is the initial size for donut
                            className="absolute left-[34.5%] top-[6%] w-[16vw] max-w-[660px] z-40 origin-center"
                        />

                        <section id="section1" className="h-screen flex items-center justify-center text-center">

                            {/* for spacing between mordern and harmony leading-[0.85] */}
                            <h1 className="font-outfit text-[11vw] text-audira-primary uppercase leading-[0.85]">
                                Donut
                                <br />
                                Obsession
                            </h1>

                        </section>

                        <section id="section2" className="min-h-screen pt-20 w-[calc(100vw-10rem)] max-w-[1440px] mx-auto">

                            <h2 className="font-outfit text-[6vw] text-audira-primary uppercase">
                                Choco Crave
                            </h2>

                            <p className="max-w-[500px] mt-4">
                                Rich chocolate wrapped in soft, fluffy perfection. Every bite is a sweet obsession you'll crave again.
                            </p>

                            <a className="bg-audira-black text-white px-5 py-2 rounded-lg mt-6 inline-block">
                                Buy Now
                            </a>

                        </section>

                        <section id="section3" className="min-h-screen flex flex-col items-center justify-center text-center">

                            <h2 className="font-outfit text-[10vw] text-audira-primary">
                                Dive Deeper
                            </h2>

                            <video autoPlay loop muted className="rounded-xl shadow-xl max-w-[500px] w-full mt-8">
                                <source src="/audira-images/video2.mp4" type="video/mp4" />
                            </video>

                        </section>

                        <section id="section4" className="min-h-screen relative">

                            <img
                                src="/audira-images/people2.png"
                                className="absolute max-w-[260px] top-[12%] left-[3%] rotate-[15deg] 
    border-[10px] border-white rounded-[10px] shadow-[0_0_30px_#73442536]"
                            />

                            <img
                                src="/audira-images/people3.png"
                                className="absolute max-w-[470px] right-[4%] top-[22%] rotate-[14deg] 
    border-[10px] border-white rounded-[10px] shadow-[0_0_30px_#73442536]"
                            />

                            <img
                                src="/audira-images/people4.png"
                                className="absolute max-w-[340px] left-[10%] bottom-[12%] -rotate-[12deg] 
    border-[10px] border-white rounded-[10px] shadow-[0_0_30px_#73442536]"
                            />

                        </section>

                        <section id="section5" className="text-center pt-[4vw] pb-[8vw] min-h-[94vh]">

                            <h2 className="heading">Top Picks</h2>

                            <div className="grid grid-cols-3 mt-12">

                                {products.map((p, i) => (
                                    <div key={i} className="flex flex-col items-center justify-end">

                                        {p.img && (
                                            <img
                                                src={p.img}
                                                className="w-full max-w-[300px] mb-6 drop-shadow-[6px_15px_5px_#00000018]"
                                            />
                                        )}

                                        <div className="text-[24px] font-medium">{p.name}</div>
                                        <div className="text-[24px] font-bold">{p.price}</div>

                                    </div>
                                ))}

                            </div>

                        </section>

                        {/* <footer className="border-t border-audira-primary flex justify-between items-center py-6 w-[calc(100vw-10rem)] max-w-[1440px] mx-auto">

              <img src="/audira-images/logo.png" className="w-[132px]" />

              <div className="flex gap-4">
                <img src="/audira-images/fb.png" className="w-6" />
                <img src="/audira-images/insta.png" className="w-6" />
              </div>

            </footer> */}

                    </main>

                </div>
            </div>

        </div>

    )
}