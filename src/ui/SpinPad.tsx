import { useEffect, useRef } from 'react'

/** Cue-ball contact-point picker: x = side English, y = follow(+)/draw(-). */
export function SpinPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!, g = c.getContext('2d')!
    g.clearRect(0, 0, 80, 80)
    g.fillStyle = '#f5f5f5'; g.beginPath(); g.arc(40, 40, 32, 0, 7); g.fill()
    g.strokeStyle = '#aaa'; g.beginPath(); g.arc(40, 40, 32, 0, 7); g.stroke()
    g.fillStyle = '#c33'; g.beginPath(); g.arc(40 + x * 28, 40 - y * 28, 5, 0, 7); g.fill()
  }, [x, y])
  return (
    <canvas
      ref={ref} width={80} height={80} style={{ background: '#1a1a1a', borderRadius: '50%', cursor: 'crosshair' }}
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        const dx = (e.clientX - r.left - 40) / 32, dy = (e.clientY - r.top - 40) / 32, m = Math.hypot(dx, dy)
        onChange(m > 1 ? dx / m : dx, m > 1 ? -dy / m : -dy)
      }}
    />
  )
}
