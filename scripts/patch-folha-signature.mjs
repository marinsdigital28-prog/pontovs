import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');
let t = fs.readFileSync(panelPath, 'utf8');

const old = `            <div className="signature-area">
              <div className="signature-block institution-signature-block">
                {signatureData ? <img className="institution-signature" src={signatureData} alt="Assinatura digital do Espaço Progredir" /> : null}
                <div className="signature-certificate-block">
                  <strong>✓ Assinado digitalmente por ESPAÇO PROGREDIR</strong>
                  <span>Certificado digital A1 · CNPJ 05.553.848/0001-61</span>
                </div>
                <div className="signature-line">Assinatura digital do Espaço Progredir</div>
              </div>`;

const neu = `            <div className="signature-area">
              <div className="signature-block institution-signature-block">
                {signatureData ? (
                  <img className="institution-signature" src={signatureData} alt="Assinatura institucional do Espaço Progredir" />
                ) : (
                  <div className="signature-missing">Assinatura institucional não carregada — configure em Dados e documentos</div>
                )}
                <div className="signature-certificate-block">
                  <strong>✓ Assinado digitalmente — Espaço Progredir</strong>
                  <span>Certificado digital A1 · CNPJ 05.553.848/0001-61</span>
                </div>
                <div className="signature-line">Assinatura institucional do Espaço Progredir</div>
              </div>`;

if (t.includes(old)) {
  t = t.replace(old, neu);
  fs.writeFileSync(panelPath, t);
  console.log('folha signature UI restored');
} else if (t.includes('Assinatura institucional do Espaço Progredir')) {
  console.log('folha signature UI already ok');
} else {
  console.log('folha signature pattern not found — skip');
}
