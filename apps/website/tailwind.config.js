/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dw: {
          bg: '#070a11',
          bg2: '#0b101d',
          surface: '#0f1526',
          surface2: '#141d33',
          border: 'rgba(255, 255, 255, 0.08)',
          borderHover: 'rgba(255, 255, 255, 0.18)',
          green: '#00e599',
          greenDim: '#00c784',
          cyan: '#00d4ff',
          amber: '#ffb74d',
          red: '#ff5252',
          text: '#f8fafc',
          muted: '#94a3b8',
          dim: '#64748b'
        },
        nv: {
          bg: '#070a11',
          bg2: '#0b101d',
          surface: '#0f1526',
          surface2: '#141d33',
          primary: '#00e599',
          primarydim: '#00c784',
          accent: '#00d4ff',
          danger: '#ff5252',
          text: '#f8fafc',
          muted: '#94a3b8',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 229, 153, 0.32)',
        glowCyan: '0 0 20px rgba(0, 212, 255, 0.30)',
        deep: '0 16px 40px -8px rgba(0, 0, 0, 0.8)'
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: [],
};
