import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Ponto Progredir — Totem',
  manifest: '/ponto.webmanifest',
  appleWebApp: { capable: true, title: 'Ponto', statusBarStyle: 'default' },
  icons: { icon: '/ponto-progredir-icon-circular.png', apple: '/ponto-progredir-icon-circular.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1F6B1F',
};

export default function PontoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
