# Referências técnicas — assinatura A1 em PDF

A implementação usa a família `@signpdf` para assinar PDFs com certificados PKCS#12/PFX em modo detached, conforme a documentação oficial:

- https://github.com/vbuch/node-signpdf
- https://www.npmjs.com/package/@signpdf/signer-p12
- https://www.npmjs.com/package/@signpdf/placeholder-pdf-lib
- https://www.npmjs.com/package/pdf-lib

Padrão confirmado na documentação: criar o PDF, adicionar placeholder de assinatura com `pdflibAddPlaceholder`, criar `P12Signer` com o buffer PFX e a opção `passphrase`, e concluir com `signpdf.sign(pdfBuffer, signer)`. O `@signpdf/signer-p12` usa `node-forge` e o placeholder PDF-LIB permite campo de assinatura em uma página gerada por `pdf-lib`.

Segurança do projeto: o PFX e a senha não devem ser versionados, impressos em logs ou enviados ao GitHub. A rota usa os segredos de ambiente `PONTO_A1_CERT_BASE64` e `PONTO_A1_PASSWORD`, com acesso restrito à sessão ADMIN/MANAGER, rate limit e evento de auditoria. A senha fornecida pelo usuário não foi registrada neste arquivo.
