import Providers from '../components/Providers';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <PwaRegister />
          {children}
        </Providers>
      </body>
    </html>
  )
}
