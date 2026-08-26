'use client';

import { useState } from 'react';

type ImportResult = { pagesDetected?: number; employeesUpdated?: number; punchesCreated?: number; punchesExisting?: number; rowsIgnored?: number; error?: string };

export default function PdfImporter() {
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ pages: number; employees: number; punches: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMessage('');
    setLoading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/admin/import-pdf', { method: 'POST', body: form });
      const data = await response.json() as ImportResult;
      if (!response.ok) throw new Error(data.error || 'Não foi possível ler o PDF.');
      setPreview({ pages: data.pagesDetected || 0, employees: data.employeesUpdated || 0, punches: (data.punchesCreated || 0) + (data.punchesExisting || 0) });
      setMessage(`PDF processado: ${data.punchesCreated || 0} novas, ${data.punchesExisting || 0} já existentes e ${data.rowsIgnored || 0} ignoradas.`);
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : 'Não foi possível processar o PDF.');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  return <div className="pdf-importer card"><div className="section-heading"><div><span className="eyebrow">BACKUP COMPLETO</span><h3>Ler PDF inteiro</h3><p className="small-muted">Percorre todas as páginas e importa cada colaborador e cada batida sem duplicar registros.</p></div><label className="primary-btn compact-btn csv-file-btn">{loading ? 'Lendo PDF...' : 'Escolher PDF'}<input type="file" accept="application/pdf,.pdf" onChange={(event) => void handleFile(event)} /></label></div>{fileName ? <p className="small-muted">Arquivo: <strong>{fileName}</strong></p> : null}{preview ? <div className="report-summary"><div className="summary"><span className="small-muted">Páginas</span><strong>{preview.pages}</strong></div><div className="summary"><span className="small-muted">Colaboradores</span><strong>{preview.employees}</strong></div><div className="summary"><span className="small-muted">Batidas lidas</span><strong>{preview.punches}</strong></div></div> : null}{message ? <div className="status-msg admin-toast">{message}</div> : null}</div>;
}
