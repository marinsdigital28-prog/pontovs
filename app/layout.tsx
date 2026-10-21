import type { Metadata } from 'next';
import Providers from '../components/Providers';
import './globals.css';
import './modulo-3/module3.css';
import './modulo-3/presenca/presenca.css';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'Ponto Progredir',
  description: 'Sistema de controle de jornada e registro de ponto.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Captura o convite de instalação antes do React carregar (o evento dispara uma única vez e cedo). */}
        <script dangerouslySetInnerHTML={{ __html: "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;window.dispatchEvent(new Event('pwa-prompt-ready'))});window.addEventListener('appinstalled',function(){window.__pwaPrompt=null;try{localStorage.setItem('pwaInstalled','1')}catch(_){}});" }} />
      </head>
      <body>
        <Providers>
          <PwaRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
