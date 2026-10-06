import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Portal Progredir',
    short_name: 'Progredir',
    description: 'Ponto, cadastro de beneficiários e chamada em tempo real das atividades.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f7f2',
    theme_color: '#1e5c2f',
    lang: 'pt-BR',
    icons: [
      { src: '/ponto-progredir-icon-circular.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/ponto-progredir-icon-circular.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'App do colaborador', short_name: 'Meu Ponto', url: '/app', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Registrar ponto', short_name: 'Ponto', url: '/ponto', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Painel administrativo', short_name: 'Admin', url: '/admin', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Módulo 3 — Beneficiários', short_name: 'Beneficiários', url: '/modulo-3', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Lista de presença', short_name: 'Chamada', url: '/modulo-3/presenca', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
