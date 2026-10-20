// Odchudzony katalog ćwiczeń dla telefonu: bez wag i instrukcji, tylko to, co potrzebne do wyboru ćwiczenia.
import fs from 'node:fs';
const ex = JSON.parse(fs.readFileSync('src/data/exercises.json', 'utf8'));
const out = ex.map(e => [e.id, e.name, e.nameEn, e.equipmentPl, e.countsForVolume ? 1 : 0, Object.keys(e.muscles)[0] ?? null, e.weightsSource === 'automatyczne' ? 0 : 1]);
fs.writeFileSync('src/phone/catalog.json', JSON.stringify(out));
console.log('katalog telefonu:', out.length, 'ćwiczeń,', fs.statSync('src/phone/catalog.json').size, 'B');
