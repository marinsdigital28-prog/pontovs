import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ponto Progredir — Colaborador',
    short_name: 'Meu Ponto',
    description: 'Consulte suas marcações, jornada e solicite ausências.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f7fa',
    theme_color: '#2563eb',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'App do colaborador', short_name: 'Meu Ponto', url: '/app', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Registrar ponto', short_name: 'Ponto', url: '/ponto', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Painel administrativo', short_name: 'Admin', url: '/admin', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
