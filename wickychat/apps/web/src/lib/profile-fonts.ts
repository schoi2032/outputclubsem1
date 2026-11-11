/**
 * WickyChat: fonts people can choose for their name and "About me" (PROFILE_FONTS in
 * @quid/shared). All are Google Fonts under the SIL Open Font License, self-hosted by
 * next/font, and only downloaded by the browser when a `.q-font-*` class is actually used.
 */
import {
  Bungee,
  Caveat,
  Nunito,
  Orbitron,
  Playfair_Display,
  Press_Start_2P,
  Space_Mono,
} from 'next/font/google'

const rounded = Nunito({ subsets: ['latin'], weight: ['600', '800'], variable: '--pf-rounded' })
const serif = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--pf-serif',
})
const mono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--pf-mono' })
const hand = Caveat({ subsets: ['latin'], weight: ['500', '700'], variable: '--pf-hand' })
const pixel = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--pf-pixel' })
const display = Bungee({ subsets: ['latin'], weight: '400', variable: '--pf-display' })
const future = Orbitron({ subsets: ['latin'], weight: ['500', '700'], variable: '--pf-future' })

/** Put on <html> so `.q-font-*` classes can use the variables. */
export const profileFontVariables = [rounded, serif, mono, hand, pixel, display, future]
  .map((f) => f.variable)
  .join(' ')
