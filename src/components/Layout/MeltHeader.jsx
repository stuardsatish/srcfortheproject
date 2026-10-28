import React, { useState, useEffect } from 'react'
import { meltAssets } from '../../assets/assets'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useGSAP(() => {
    gsap.from('header', {
      y: '-25%',
      opacity: 0
    })
  })

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  return (
    <>
      <header className='sticky top-0 z-20 flex items-stretch justify-between gap-3 md:gap-5 max-w-7xl m-auto p-4 md:p-6'>
        <div className="flex items-center justify-between bg-white rounded-xl w-full px-4 py-3">
          <img src={meltAssets.melt_logo} alt="Melt Chocolate" className='max-w-28 md:max-w-36' />

          {/* Desktop nav */}
          <nav className='hidden md:block'>
            <ul className='flex items-center gap-9 font-medium tracking-tight'>
              <li><a href="">Flavors</a></li>
              <li><a href="">Our Story</a></li>
              <li><a href="">How it's Made</a></li>
              <li>
                <a href="" className='flex items-center justify-between gap-2'>
                  Gifting <img src={meltAssets.colored_gift} alt="Gift" className='max-w-11 pb-2' />
                </a>
              </li>
            </ul>
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`hamburger-btn text-[#571F01] md:hidden ${mobileMenuOpen ? 'active' : ''}`}
            aria-label="Toggle menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        {/* Desktop CTA */}
        <a href="" className='hidden md:flex items-center justify-center bg-white rounded-xl text-nowrap px-4 py-3 font-medium gap-3'>
          Explore Flavors
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="16" transform="matrix(-1 0 0 1 32 0)" fill="#FF6B57" />
            <path d="M23 16H9M23 16L17 22M23 16L17 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={`mobile-drawer-backdrop md:hidden ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <div className={`mobile-drawer md:hidden ${mobileMenuOpen ? 'open' : ''}`}
        style={{ background: 'var(--color-beige)' }}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-6 border-b border-brown/10">
            <img src={meltAssets.melt_logo} alt="Melt Chocolate" className='max-w-28' />
          </div>

          <div className="flex-1 py-6">
            {['Flavors', 'Our Story', "How it's Made", 'Gifting'].map((item) => (
              <a
                key={item}
                href=""
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center px-6 min-h-[52px] text-base font-medium text-brown/70 hover:text-brown hover:bg-brown/5 transition-all"
              >
                {item}
              </a>
            ))}
          </div>

          <div className="p-6 border-t border-brown/10">
            <a
              href=""
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-3 bg-orange text-white rounded-xl px-4 py-4 font-medium text-sm"
            >
              Explore Flavors
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="16" transform="matrix(-1 0 0 1 32 0)" fill="white" />
                <path d="M23 16H9M23 16L17 22M23 16L17 10" stroke="#FF6B57" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

export default Header