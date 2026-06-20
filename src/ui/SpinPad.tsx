import { useEffect, useRef, type PointerEvent } from 'react'

/** Cue-ball contact-point picker: x = side English, y = follow(+)/draw(-). */
export function SpinPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const size = 112
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size, size)

    const cx = size / 2, cy = size / 2, r = 45
    const ball = g.createRadialGradient(cx - 16, cy - 18, 4, cx, cy, r)
    ball.addColorStop(0, '#fffaf0')
    ball.addColorStop(0.44, '#efe6d2')
    ball.addColorStop(1, '#b9ad98')
    g.fillStyle = ball
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()

    g.save()
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.clip()
    g.strokeStyle = 'rgba(39,49,47,.28)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(cx - r, cy)
    g.lineTo(cx + r, cy)
    g.moveTo(cx, cy - r)
    g.lineTo(cx, cy + r)
    g.stroke()
    g.setLineDash([3, 6])
    g.strokeStyle = 'rgba(39,49,47,.18)'
    g.beginPath()
    g.arc(cx, cy, r * 0.56, 0, Math.PI * 2)
    g.stroke()
    g.restore()

    const hx = cx + x * (r - 8)
    const hy = cy - y * (r - 8)
    g.shadowColor = 'rgba(148,28,24,.45)'
    g.shadowBlur = 10
    g.fillStyle = '#b91f1a'
    g.beginPath()
    g.arc(hx, hy, 6, 0, Math.PI * 2)
    g.fill()
    g.shadowBlur = 0
    g.strokeStyle = 'rgba(255,255,255,.8)'
    g.lineWidth = 2
    g.stroke()

    g.strokeStyle = 'rgba(255,255,255,.38)'
    g.lineWidth = 1
    g.beginPath()
    g.arc(cx - 7, cy - 9, r + 1, Math.PI * 1.12, Math.PI * 1.72)
    g.stroke()
  }, [x, y])

  const update = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cx = rect.width / 2, cy = rect.height / 2, r = rect.width * 0.4
    const dx = (event.clientX - rect.left - cx) / r
    const dy = (event.clientY - rect.top - cy) / r
    const m = Math.hypot(dx, dy)
    onChange(m > 1 ? dx / m : dx, m > 1 ? -dy / m : -dy)
  }

  return (
    <canvas
      ref={ref}
      className="spinCanvas"
      role="slider"
      aria-label="Cue ball spin"
      aria-valuetext={`${x.toFixed(2)}, ${y.toFixed(2)}`}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e)
      }}
      onPointerMove={e => { if (e.buttons) update(e) }}
      onDoubleClick={() => onChange(0, 0)}
    />
  )
}
