/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0f1117',
          blue: '#3b82f6',
          hover: '#2563eb'
        },
        nv: {
          bg: '#04060c',
          bg2: '#070b14',
          surface: '#0b1220',
          surface2: '#0e1626',
          primary: '#00ff9d',
          primarydim: '#00c77a',
          accent: '#00d4ff',
          danger: '#ff3b6b',
          text: '#e7f2ff',
          muted: '#7d8ea8',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 18px rgba(0,255,157,0.35)',
        glowstrong: '0 0 32px rgba(0,255,157,0.55)',
      }
    }
  },
  plugins: [],
};
