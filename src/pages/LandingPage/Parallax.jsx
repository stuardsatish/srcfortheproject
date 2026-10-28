import React from "react";
import { meltAssets } from "../../assets/assets";

const Parallax = () => {
  return (
    <section className="inner-container h-[70vh] md:h-screen py-10 md:py-20">
      <div
        className="h-full rounded-xl bg-scroll md:bg-fixed bg-center bg-cover"
        style={{
          backgroundImage: `url(${meltAssets.choclate_bg_2})`,
        }}
      />
    </section>
  );
};

export default Parallax;