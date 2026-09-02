import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marinsdigital.pontoprogredir',
  appName: 'Ponto Progredir',
  webDir: 'public',
  server: {
    url: 'https://ponto.marinsdistemas.xyz/app?native=1',
    cleartext: false,
    allowNavigation: ['ponto.marinsdistemas.xyz'],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
