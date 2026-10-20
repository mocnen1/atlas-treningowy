// Zdjęcia ćwiczenia (free-exercise-db, domena publiczna): pozycja początkowa i końcowa przełączane jak krótka animacja.
// Pliki leżą obok aplikacji: img/<id>/0.webp, 1.webp oraz miniatura t.webp.
// Komputer: pliki w paczce programu. Telefon: pobierane z GitHub Pages i zapamiętywane do pracy offline.
import { useEffect, useState } from 'react';

export const imgUrl = (id: string, f: '0' | '1' | 't') => `./img/${encodeURIComponent(id)}/${f}.webp`;

export function ExerciseAnim({ id, alt, interval = 1100, className = '' }: { id: string; alt: string; interval?: number; className?: string }) {
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFrame(0); setFailed(false); }, [id]);
  useEffect(() => {
    if (paused || failed) return;
    const t = setInterval(() => setFrame(f => 1 - f), interval);
    return () => clearInterval(t);
  }, [paused, failed, interval, id]);
  if (failed) return <div className={`ex-anim missing ${className}`}>Zdjęcie niedostępne – połącz się z internetem, żeby je pobrać.</div>;
  return (
    <figure className={`ex-anim ${className}`} onClick={() => setPaused(p => !p)} title={paused ? 'Stuknij, aby wznowić' : 'Stuknij, aby zatrzymać'}>
      <img src={imgUrl(id, '0')} alt={`${alt} – pozycja początkowa`} className={frame === 0 ? 'on' : ''} onError={() => setFailed(true)} decoding="async" />
      <img src={imgUrl(id, '1')} alt={`${alt} – pozycja końcowa`} className={frame === 1 ? 'on' : ''} onError={() => setFailed(true)} decoding="async" />
      <figcaption>
        <span className={frame === 0 ? 'on' : ''}>początek</span><span className={frame === 1 ? 'on' : ''}>koniec</span>
        {paused && <b>zatrzymane</b>}
      </figcaption>
    </figure>
  );
}

export function ExerciseThumb({ id, has, size = 40 }: { id: string; has: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!has || failed) return <span className="ex-thumb none" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="ex-thumb" src={imgUrl(id, 't')} width={size} height={size} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
