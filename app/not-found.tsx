export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#071911', color: '#f2f7f4', textAlign: 'center' }}>
      <div>
        <p style={{ color: '#d4af37', letterSpacing: '.14em', fontWeight: 800 }}>PONTO PROGREDIR</p>
        <h1 style={{ fontSize: '2rem', margin: '.5rem 0' }}>Página não encontrada</h1>
        <p style={{ color: '#b5c7bf' }}>Confira o endereço e tente novamente.</p>
        <a href="/ponto" style={{ display: 'inline-block', marginTop: '1rem', padding: '.75rem 1rem', borderRadius: '10px', background: '#d4af37', color: '#11241d', fontWeight: 800, textDecoration: 'none' }}>Ir para o ponto</a>
      </div>
    </main>
  );
}
