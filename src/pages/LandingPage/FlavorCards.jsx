import React from 'react'

const FlavorCards = ({ setActiveFlavor }) => {
  return (
    <>
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 items-end pb-16 md:pb-30 h-auto md:h-screen mt-8 md:mt-0'>
        <div className='relative group card caramel-card bg-orange w-full h-[25vh] md:h-[40vh] rounded-xl origin-top transform transition-transform duration-500 ease-out md:hover:scale-y-[1.08] flex flex-col items-center justify-end overflow-hidden pb-4 md:pb-6'
        onMouseEnter={() => setActiveFlavor('caramel')}
        onMouseLeave={() => setActiveFlavor(null)}>
          <p className="mt-3 text-white text-sm md:text-base text-center leading-tight md:leading-snug opacity-100 md:opacity-0
                translate-y-0 md:translate-y-6 md:group-hover:opacity-100
                md:group-hover:translate-y-0
                transition-all duration-500 ease-out">
            Sweet crunch,<br />slow melt.
          </p>
        </div>
        <div className='relative group card cocoa-card bg-melt-blue w-full h-[25vh] md:h-[40vh] rounded-xl origin-top transform transition-transform duration-500 ease-out md:hover:scale-y-[1.08] flex flex-col items-center justify-end overflow-hidden pb-4 md:pb-6' onMouseEnter={() => setActiveFlavor('cocoa')}
        onMouseLeave={() => setActiveFlavor(null)}>
          <p className="mt-3 text-white text-sm md:text-base text-center leading-tight md:leading-snug opacity-100 md:opacity-0
                translate-y-0 md:translate-y-6 md:group-hover:opacity-100
                md:group-hover:translate-y-0
                transition-all duration-500 ease-out">
            Bold cocoa with a<br />deep finish.
          </p>
        </div>
        <div className='relative group card orange-card bg-melt-yellow w-full h-[25vh] md:h-[40vh] rounded-xl origin-top transform transition-transform duration-500 ease-out md:hover:scale-y-[1.08] flex flex-col items-center justify-end overflow-hidden pb-4 md:pb-6' onMouseEnter={() => setActiveFlavor('orange')}
        onMouseLeave={() => setActiveFlavor(null)}>
          <p className="mt-3 text-white text-sm md:text-base text-center leading-tight md:leading-snug opacity-100 md:opacity-0
                translate-y-0 md:translate-y-6 md:group-hover:opacity-100
                md:group-hover:translate-y-0
                transition-all duration-500 ease-out">
            Bright citrus with<br />creamy balance.
          </p>
        </div>
        <div className='relative group card almond-card bg-green w-full h-[25vh] md:h-[40vh] rounded-xl origin-top transform transition-transform duration-500 ease-out md:hover:scale-y-[1.08] flex flex-col items-center justify-end overflow-hidden pb-4 md:pb-6' onMouseEnter={() => setActiveFlavor('almond')}
        onMouseLeave={() => setActiveFlavor(null)}>
          <p className="mt-3 text-white text-sm md:text-base text-center leading-tight md:leading-snug opacity-100 md:opacity-0
                translate-y-0 md:translate-y-6 md:group-hover:opacity-100
                md:group-hover:translate-y-0
                transition-all duration-500 ease-out">
            Nutty comfort, <br />perfectly smooth.
          </p>
        </div>
      </div>
    </>
  )
}

export default FlavorCards