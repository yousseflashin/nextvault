/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dw: {
          bg: '#0b0d14',
          bg2: '#07080d',
          surface: '#11141c',
          surface2: '#1a1e28',
          border: 'rgba(238, 240, 245, 0.08)',
          borderHover: 'rgba(238, 240, 245, 0.16)',
          green: '#10b981',
          greenDim: '#059669',
          cyan: '#10b981',
          amber: '#f59e0b',
          red: '#e5484d',
          text: '#eef0f5',
          muted: '#a3a9b8',
          dim: '#7a8296'
        },
        nv: {
          bg: '#0b0d14',
          bg2: '#07080d',
          surface: '#11141c',
          surface2: '#1a1e28',
          primary: '#10b981',
          primarydim: '#059669',
          accent: '#10b981',
          danger: '#e5484d',
          text: '#eef0f5',
          muted: '#a3a9b8',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      boxShadow: {
        glow: 'none',
        glowCyan: 'none',
        deep: '0 8px 24px rgba(0, 0, 0, 0.4)'
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)'
      }
    }
  },
  plugins: [],
};
