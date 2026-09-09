import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'app/ponto/page.tsx');
let t = fs.readFileSync(p, 'utf8');

if (!t.includes('getUserMedia')) {
  console.warn('ponto page missing getUserMedia — skip perf patch');
  process.exit(0);
}

// GPS: stop blocking 5s with high accuracy on every punch
t = t.replace(
  "{ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }",
  "{ enableHighAccuracy: false, timeout: 2500, maximumAge: 120000 }",
);

// Camera: open faster (640 instead of 1920)
t = t.replace(
  "width: { ideal: 1920 }, height: { ideal: 1920 }",
  "width: { ideal: 640 }, height: { ideal: 640 }",
);

// Photo: smaller/faster encode+upload
t = t.replace("canvas.width = 720;", "canvas.width = 480;");
t = t.replace("canvas.height = 720;", "canvas.height = 480;");
t = t.replace("0, 0, 720, 720)", "0, 0, 480, 480)");
t = t.replace("toDataURL('image/jpeg', 0.9)", "toDataURL('image/jpeg', 0.72)");

// Confirmation screen a bit shorter
t = t.replaceAll(
  "window.setTimeout(() => resetForNextCollaborator(), 2200);",
  "window.setTimeout(() => resetForNextCollaborator(), 1400);",
);

fs.writeFileSync(p, t);
console.log('ponto perf patch applied', {
  gpsFast: t.includes('enableHighAccuracy: false'),
  cam640: t.includes('ideal: 640'),
  jpeg72: t.includes("0.72"),
});
