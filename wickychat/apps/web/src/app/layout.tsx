import { DEFAULT_ACCENT } from '@quid/shared'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'WickyChat', template: '%s · WickyChat' },
  description: 'WickyChat, the school chat for Chadwick International. Made by Output Club.',
  icons: { icon: '/icon.svg' },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wickychat.vercel.app'),
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181614' },
  ],
}

// Applies saved preferences before first paint to avoid a flash. Mirrors applyPreferences() in lib/preferences.ts.
const themeScript = `try{var r=document.documentElement,p={};try{p=JSON.parse(localStorage.getItem('quid-prefs')||'{}')||{}}catch(e){}var t=p.theme||localStorage.getItem('quid-theme')||'system';r.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));['contrast','font','textSize','radius','motion','density','animateAvatars'].forEach(function(k){if(typeof p[k]==='string')r.dataset[k]=p[k]});var a=p.accent;if(typeof a!=='string'||a.toLowerCase()==='${DEFAULT_ACCENT}')a=localStorage.getItem('quid-org-accent');if(typeof a==='string'&&/^#[0-9a-f]{6}$/i.test(a)&&a.toLowerCase()!=='${DEFAULT_ACCENT}'){r.dataset.accent='';r.style.setProperty('--q-accent-base',a)}}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, first-party theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
