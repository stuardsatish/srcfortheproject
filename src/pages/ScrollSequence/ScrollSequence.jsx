import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const frameCount = 452;

const ScrollSequence = () => {
  const canvasRef = useRef(null);
  const sectionRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    // Set canvas dimensions
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const imageCache = {};
    const imageSeq = { frame: 0 };

    const getFrameSrc = (i) =>
      `/frames/frame_${String(i + 1).padStart(4, "0")}.jpg`;

    // Preload all images or logic to handle them
    const loadImages = () => {
      for (let i = 0; i < frameCount; i++) {
        const img = new Image();
        img.src = getFrameSrc(i);
        imageCache[i] = img;
      }
    };

    function render() {
      const img = imageCache[Math.round(imageSeq.frame)];
      if (img && img.complete) {
        context.clearRect(0, 0, canvas.width, canvas.height);
       
        // Basic "cover" logic for background images
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width / 2) - (img.width / 2) * scale;
        const y = (canvas.height / 2) - (img.height / 2) * scale;
       
        context.drawImage(img, x, y, img.width * scale, img.height * scale);
      }
    }

    loadImages();

    // Ensure the first image is loaded before starting
    imageCache[0].onload = () => {
      render();
      setReady(true);

      const tl = gsap.to(imageSeq, {
        frame: frameCount - 1,
        snap: "frame",
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          // Adjust this multiplier to change scroll speed
          end: "+=" + (frameCount * 7),
          scrub: 0.5, // Lowering this makes it feel more responsive
          pin: true,
          // If you still see a gap, you can set pinSpacing: false,
          // but usually keeping it true is better for page flow.
          pinSpacing: true,
          onUpdate: (self) => {
            // Force render on scroll update
            render();
          }
        }
      });
    };

    // Cleanup on unmount
    return () => {
      ScrollTrigger.getAll().forEach(t => t.kill());
    };
  }, []);

  return (
    <>
      {!ready && (
        <div style={loadingStyle}>Loading animation...</div>
      )}

      {/* This wrapper ensures the scroll area exists */}
      <div ref={sectionRef} style={{ backgroundColor: "#000" }}>
        <section style={{ height: "100vh", width: "100%", overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            style={{ display: "block", objectFit: "cover" }}
          />
        </section>
      </div>
     
      {/* Optional: Add a footer or next section to see the transition */}
      <div style={{ height: "100vh", background: "#111", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <h2>End of Sequence</h2>
      </div>
    </>
  );
};

const loadingStyle = {
  position: "fixed",
  inset: 0,
  background: "black",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "28px",
  zIndex: 9999
};

export default ScrollSequence;