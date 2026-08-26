'use client';

import { useEffect, useState } from 'react';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export default function SignatureSettings() {
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/signature', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a assinatura.');
        if (!cancelled) setSignatureData(data.signatureData || null);
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Não foi possível carregar a assinatura.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async (value: string | null) => {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/signature', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signatureData: value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar a assinatura.');
      setSignatureData(value);
      setMessage(value ? 'Assinatura salva e pronta para a Folha de Ponto.' : 'Assinatura removida.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar a assinatura.');
    } finally { setSaving(false); }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setMessage('Escolha uma imagem PNG, JPG ou WebP.'); return; }
    if (file.size > MAX_FILE_BYTES) { setMessage('A imagem deve ter no máximo 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') void save(reader.result); };
    reader.onerror = () => setMessage('Não foi possível ler a imagem selecionada.');
    reader.readAsDataURL(file);
  };

  return <section className="card signature-settings">
    <div className="section-heading">
      <div><span className="eyebrow">DOCUMENTO OFICIAL</span><h2>Assinatura do Espaço Progredir</h2><p className="small-muted">A imagem será exibida na Folha de Ponto e na impressão A4. Use uma assinatura institucional em fundo transparente.</p></div>
      {signatureData ? <span className="status-pill ok">Configurada</span> : <span className="status-pill off">Não configurada</span>}
    </div>
    {loading ? <p className="small-muted">Carregando configuração...</p> : <>
      <div className="signature-preview">{signatureData ? <img src={signatureData} alt="Assinatura institucional configurada" /> : <span>Nenhuma assinatura enviada</span>}</div>
      <div className="row-actions signature-actions"><label className="primary-btn compact-btn signature-upload">{saving ? 'Salvando...' : 'Escolher assinatura'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={saving} /></label>{signatureData ? <button type="button" className="ghost-btn" onClick={() => void save(null)} disabled={saving}>Remover assinatura</button> : null}</div>
    </>}
    {message ? <p className="status-msg">{message}</p> : null}
  </section>;
}
