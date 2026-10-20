'use client';

const APP_TZ = 'America/Sao_Paulo';

function monthLabel(d = new Date()) {
  return d.toLocaleDateString('pt-BR', { timeZone: APP_TZ, month: 'long', year: 'numeric' });
}

/** Aviso de fechamento mensal (movido da antiga Central de Integridade). */
export default function PeriodClosureCard() {
  const currentMonth = monthLabel();
  return (
    <div className="card" style={{ marginTop: 20, padding: 16, border: '1px solid #f0c14b' }}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">FECHAMENTO MENSAL</span>
          <h3 style={{ margin: '4px 0' }}>Período {currentMonth} — Em aberto</h3>
          <p className="small-muted">
            Faça o <strong>backup do mês</strong> abaixo antes de fechar a folha. O fechamento formal ainda não arquiva nem apaga dados automaticamente.
          </p>
        </div>
      </div>
      <div className="status-msg" style={{ marginTop: 8 }}>
        ⚠️ Arquivamento e limpeza só serão permitidos após: (1) mês marcado como fechado, (2) backup validado e (3) confirmação explícita.
      </div>
    </div>
  );
}
