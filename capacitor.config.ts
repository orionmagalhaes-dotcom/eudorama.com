import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eudorama.app',
  appName: 'Eudorama',
  webDir: 'dist',
  server: {
    url: 'https://eudorama.com',
    cleartext: true
  }
};

export default config;
