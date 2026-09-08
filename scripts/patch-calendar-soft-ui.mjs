import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = path.join(root, 'app/admin/absence-calendar.css');
const ov = path.join(root, 'app/admin/overview-layout.css');

if (fs.existsSync(abs)) {
  let t = fs.readFileSync(abs, 'utf8');
  const pairs = [
    ['border-radius: 24px;', 'border-radius: 28px;'],
    ['border-radius: 16px;\n  background: #fff;', 'border-radius: 18px;\n  background: #fff;'],
    ['border-radius: 18px;\n  border: 1px solid rgba(11, 92, 66, 0.12);', 'border-radius: 20px;\n  border: 1px solid rgba(11, 92, 66, 0.1);'],
    ['border-radius: 14px;\n  background: #fff;', 'border-radius: 16px;\n  background: #fff;'],
    ['border-radius: 14px;', 'border-radius: 16px;'],
    ['border-radius: 8px;', 'border-radius: 10px;'],
    ['border-radius: 11px;', 'border-radius: 14px;'],
    ['0 20px 48px rgba(8, 53, 40, 0.09)', '0 12px 40px rgba(8, 53, 40, 0.06)'],
    ['0 6px 16px rgba(8, 53, 40, 0.04)', '0 4px 14px rgba(8, 53, 40, 0.03)'],
    ['box-shadow: 0 1px 3px rgba(8, 53, 40, 0.04)', 'box-shadow: 0 2px 8px rgba(8, 53, 40, 0.04)'],
    ['0 12px 26px rgba(8, 53, 40, 0.11)', '0 10px 28px rgba(8, 53, 40, 0.08)'],
    ['0 10px 22px rgba(201, 162, 39, 0.1)', '0 8px 24px rgba(201, 162, 39, 0.08)'],
    ['0 14px 28px rgba(11, 92, 66, 0.12)', '0 10px 28px rgba(11, 92, 66, 0.08)'],
    ['0 6px 20px rgba(8, 53, 40, 0.05)', '0 6px 24px rgba(8, 53, 40, 0.04)'],
    ['0 2px 10px rgba(8, 53, 40, 0.03)', '0 3px 12px rgba(8, 53, 40, 0.04)'],
    ['0 8px 18px rgba(8, 53, 40, 0.08)', '0 8px 22px rgba(8, 53, 40, 0.06)'],
    ['0 6px 18px rgba(11, 92, 66, 0.32)', '0 4px 14px rgba(11, 92, 66, 0.22)'],
    ['0 6px 14px rgba(11, 92, 66, 0.12)', '0 4px 12px rgba(11, 92, 66, 0.08)'],
    ['0 5px 12px rgba(201, 162, 39, 0.4)', '0 4px 12px rgba(201, 162, 39, 0.28)'],
  ];
  for (const [a, b] of pairs) t = t.split(a).join(b);
  fs.writeFileSync(abs, t);
  console.log('absence soft ui patched');
}

if (fs.existsSync(ov)) {
  let t = fs.readFileSync(ov, 'utf8');
  t = t.replace('border-radius:20px!important;', 'border-radius:24px!important;');
  t = t.replace('box-shadow:0 14px 36px rgba(8,53,40,.07)!important;', 'box-shadow:0 10px 32px rgba(8,53,40,.05)!important;');
  t = t.replace(
    'min-height:88px;border:1px solid #e3ebe4;border-radius:12px;background:#fafcf9;',
    'min-height:88px;border:1px solid #e3ebe4;border-radius:16px;background:#fafcf9;box-shadow:0 2px 8px rgba(8,53,40,.03);',
  );
  t = t.replace(
    'padding:.55rem .65rem;border-radius:12px;background:#f4f7f2;border:1px solid #e3ebe4',
    'padding:.55rem .65rem;border-radius:14px;background:#f4f7f2;border:1px solid #e3ebe4;box-shadow:0 2px 8px rgba(8,53,40,.03)',
  );
  fs.writeFileSync(ov, t);
  console.log('overview soft ui patched');
}
