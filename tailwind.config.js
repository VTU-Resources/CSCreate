/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
      },
      // Custom utility for Safe Area (Capacitor/iOS/Android)
      padding: {
        'safe': 'env(safe-area-inset-top)',
      },
      // Ensures content doesn't get hidden under fixed bottom nav
      spacing: {
        '20-safe': '5rem + env(safe-area-inset-bottom)', 
      },
    },
  },
  plugins: [],
}