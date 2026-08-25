import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ponto Progredir',
    short_name: 'Ponto Progredir',
    description: 'Sistema de controle de jornada e registro de ponto.',
    start_url: '/ponto',
    display: 'standalone',
    background_color: '#F6F8F1',
    theme_color: '#137A3A',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Registrar ponto', short_name: 'Ponto', url: '/ponto', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Painel administrativo', short_name: 'Admin', url: '/admin', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
