import type { Metadata } from 'next';
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import MotionProvider from '@/components/MotionProvider';
import { FAQS } from '@/lib/content';
import './globals.css';

// next/font self-hosts and subsets these as woff2 — handoff §09 asks for no
// render-blocking request to fonts.googleapis.com.
const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-chakra-petch',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const SITE = 'https://jrprintforge.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'JR Print Forge — Precision 3D Printing, Forged for Innovation',
  description:
    'Engineering-grade additive manufacturing. Quotes in one business day, ±0.10 mm typical tolerance, 12 named materials, every part inspected before it ships.',
  openGraph: {
    type: 'website',
    url: SITE,
    siteName: 'JR Print Forge',
    title: 'JR Print Forge — Precision 3D Printing, Forged for Innovation',
    description:
      'Engineering-grade additive manufacturing. Quotes in one business day, ±0.10 mm typical tolerance, every part inspected before it ships.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'JR Print Forge' }],
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

/** Organization + Service + FAQPage — handoff §09. */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#org`,
      name: 'JR Print Forge',
      url: SITE,
      description:
        'Precision additive manufacturing for engineers, inventors and the people who have to ship.',
      email: 'quotes@jrprintforge.com',
    },
    {
      '@type': 'Service',
      '@id': `${SITE}/#service`,
      name: 'Precision 3D printing and additive manufacturing',
      provider: { '@id': `${SITE}/#org` },
      serviceType: 'Additive manufacturing',
      areaServed: 'US',
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE}/#faq`,
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${chakraPetch.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="bg-ground text-body-bright">
        <a
          href="#top"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-blue focus:bg-ground focus:px-4 focus:py-3 focus:font-mono focus:text-[11px] focus:uppercase focus:tracking-[0.2em] focus:text-blue"
        >
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
