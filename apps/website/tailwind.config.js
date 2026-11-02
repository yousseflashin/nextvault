/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dw: {
          bg: '#05070a',
          bg2: '#090d14',
          surface: '#0e131e',
          surface2: '#131b2a',
          border: '#1a2336',
          borderHover: '#293754',
          green: '#00e676',
          greenDim: '#00b359',
          cyan: '#00d4ff',
          amber: '#fbbf24',
          red: '#f43f5e',
          text: '#f1f5f9',
          muted: '#8b9bb4',
          dim: '#475569'
        },
        nv: {
          bg: '#05070a',
          bg2: '#090d14',
          surface: '#0e131e',
          surface2: '#131b2a',
          primary: '#00e676',
          primarydim: '#00b359',
          accent: '#00d4ff',
          danger: '#f43f5e',
          text: '#f1f5f9',
          muted: '#8b9bb4',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 16px rgba(0, 230, 118, 0.25)',
        glowCyan: '0 0 16px rgba(0, 212, 255, 0.25)',
        deep: '0 12px 36px -8px rgba(0, 0, 0, 0.7)'
      }
    }
  },
  plugins: [],
};
