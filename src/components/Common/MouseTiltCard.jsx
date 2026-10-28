import { useRef, useState } from 'react'
import useIsMobile from '../../hooks/useIsMobile'

const MouseTiltCard = ({ children, className = "" }) => {
  const cardRef = useRef(null)
  const [transform, setTransform] = useState('')
  const isMobile = useIsMobile()

  const handleMouseMove = (e) => {
    // Disable tilt on touch/mobile devices
    if (isMobile) return
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const rotateX = (y - centerY) / 10
    const rotateY = (centerX - x) / 10
    setTransform(`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`)
  }

  const handleMouseLeave = () => {
    setTransform('')
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transform: isMobile ? '' : transform, transition: 'transform 0.1s ease' }}
      className={className}
    >
      {children}
    </div>
  )
}

export default MouseTiltCard