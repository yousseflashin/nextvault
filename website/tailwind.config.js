/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0f1117',
          blue: '#3b82f6',
          hover: '#2563eb'
        }
      }
    },
  },
  plugins: [],
}

