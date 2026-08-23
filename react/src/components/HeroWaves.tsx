import { useEffect, useRef } from 'react';
import { useUi } from '../store/ui';

interface Wave {
  amp: number;
  freq: number;
  speed: number;
  phase: number;
  color: string; // base color; wave 0 is ink-synced
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  o: number;
  life: number;
  maxLife: number;
}

/** App-wide animated waveform + particle field, ported 1:1 from the shipping
 *  app's heroCanvas loop. Fixed behind the whole UI, visible most on Home.
 *  Theme-aware (ink color flips with light mode) and honours
 *  prefers-reduced-motion (draws one static frame, no loop). */
export function HeroWaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let inkRGB = '242,236,227';

    const waves: Wave[] = [
      { amp: 30, freq: 0.015, speed: 0.005, phase: 0, color: '' },
      { amp: 19, freq: 0.027, speed: 0.009, phase: 1.8, color: 'rgba(196,102,74,0.14)' },
      { amp: 13, freq: 0.041, speed: 0.013, phase: 3.2, color: 'rgba(200,169,110,0.11)' },
      { amp: 7, freq: 0.056, speed: 0.017, phase: 0.7, color: 'rgba(122,158,140,0.09)' },
    ];

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const MAX_PARTICLES = 35;
    const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
      x: Math.random() * (W || 1200),
      y: Math.random() * (H || 800),
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4 - 0.08,
      r: 1 + Math.random() * 2.5,
      o: 0.15 + Math.random() * 0.35,
      life: Math.random() * 300,
      maxLife: 300 + Math.random() * 200,
    }));

    let time = 0;
    let raf = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      time += 1;

      // Waves — wave 0 follows the current ink color
      waves[0].color = `rgba(${inkRGB},0.22)`;
      for (const w of waves) {
        ctx.beginPath();
        const yBase = H * 0.5;
        for (let x = 0; x < W; x += 2) {
          const y = yBase + Math.sin(x * w.freq + time * w.speed + w.phase) * w.amp
            + Math.sin(x * w.freq * 2.3 + time * w.speed * 0.6 + w.phase * 1.5) * w.amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = w.color;
        ctx.lineWidth = w.amp > 26 ? 2.0 : 1.5;
        ctx.stroke();
      }

      // Particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 1;
        if (p.life > p.maxLife || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
          p.x = Math.random() * W;
          p.y = H + 10;
          p.vx = (Math.random() - 0.5) * 0.4;
          p.vy = -0.1 - Math.random() * 0.3;
          p.life = 0;
        }
        const fade = 1 - p.life / p.maxLife;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${inkRGB},${p.o * fade * 0.45})`;
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    // Theme sync — light mode flips the ink color immediately
    inkRGB = theme === 'light' ? '42,39,35' : '242,236,227';

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return <canvas ref={canvasRef} className="hero-waves" aria-hidden="true" />;
}