/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Aged parchment / 宣纸
        parchment: {
          50: '#f8f1de',
          100: '#f3e9cf',
          200: '#ecdfb7',
          300: '#e0cf95',
          400: '#cab36a',
          500: '#a8924c',
          600: '#8a7437',
          700: '#6a5727',
          800: '#4a3c1b',
          900: '#2b220f',
        },
        // 印章红 — vermillion seal color
        seal: {
          50: '#fbe9e7',
          100: '#f5c8c3',
          200: '#ec9d96',
          300: '#df6c63',
          400: '#cf3b30',
          500: '#b71c1c',
          600: '#9a1414',
          700: '#7d0e0e',
          800: '#5d0808',
          900: '#3d0404',
        },
        // 墨色 ink
        ink: {
          50: '#f5f2ed',
          100: '#e8e3d8',
          200: '#cdc4b0',
          300: '#a89a7a',
          400: '#7d6e4f',
          500: '#564a35',
          600: '#3d3324',
          700: '#2a2218',
          800: '#1a140e',
          900: '#0d0a06',
        },
        // Faction palette — each lord gets a banner color tuned to fit on parchment
        faction: {
          dongzhuo: '#7d1a1a',
          yuanshao: '#264a8a',
          caocao: '#6b1f7d',
          gongsunzan: '#7a6a4a',
          liubei: '#2f6b3a',
          sunjian: '#1f6a7a',
          liubiao: '#a07a2c',
          liuyan: '#386a78',
          mahan: '#a64225',
          taoqian: '#8a6a18',
          kongrong: '#8a3a76',
          yuanshu: '#3a7a4a',
          liuyu: '#6a6e6a',
          zhanglu: '#b0a070',
          gongsundu: '#34526e',
          neutral: '#94876a',
        },
        // Terrain pastel underlays
        terrain: {
          plain: '#ead7a0',
          plainAlt: '#dec98f',
          mountain: '#b4a37b',
          forest: '#8fa37a',
          river: '#7fa9c1',
          city: '#f3e9cf',
        },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', 'STSong', 'serif'],
        display: ['"Cinzel"', '"Noto Serif SC"', 'serif'],
      },
      boxShadow: {
        seal: '0 1px 3px rgba(120, 40, 30, 0.3), inset 0 0 0 1px rgba(120, 40, 30, 0.4)',
        scroll: '0 8px 24px -8px rgba(60, 40, 20, 0.35)',
      },
      backgroundImage: {
        'paper-noise':
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.35 0 0 0 0 0.20 0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' /></svg>\")",
      },
    },
  },
  plugins: [],
};
