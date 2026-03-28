/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        androidGreen: '#3DDC84',
      },
      boxShadow: {
        brutal: '6px 6px 0px 0px #000000',
      }
    },
  },
  plugins: [],
}
