import React, { useEffect, useState } from 'react'
import { useColors } from '../theme'

const PARTICLE_COUNT = 25
const ANIMATION_DURATION = 1500 // ms

export function ConfettiCelebration() {
  const colors = useColors()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), ANIMATION_DURATION + 200)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const left = Math.random() * 100
    const delay = Math.random() * 0.5
    const duration = 1 + Math.random() * 0.5
    const rotation = Math.random() * 720
    const size = 4 + Math.random() * 4
    const colorOptions = [colors.accent, colors.statusComplete, colors.accentSoft]
    const color = colorOptions[i % colorOptions.length]

    return (
      <span
        key={i}
        className="clui-confetti-particle"
        style={{
          left: `${left}%`,
          animationDelay: `${delay}s`,
          animationDuration: `${duration}s`,
          backgroundColor: color,
          width: size,
          height: size,
          transform: `rotate(${rotation}deg)`,
        }}
      />
    )
  })

  return (
    <div
      data-testid="confetti-celebration"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        height: 120,
      }}
    >
      {particles}
    </div>
  )
}
