// Topographic contour lines drawn from a deterministic height field, so the
// server and browser render identical markup. Decorative only.
const WIDTH = 600;
const HEIGHT = 800;

function ring(cx: number, cy: number, radius: number, seed: number): string {
  const points: string[] = [];
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.16 * Math.sin(angle * 3 + seed) +
      0.08 * Math.sin(angle * 5 + seed * 1.7) +
      0.05 * Math.cos(angle * 7 - seed);
    const r = radius * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * 1.15;
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `${points.join(' ')}Z`;
}

const PEAKS = [
  { cx: 170, cy: 230, rings: 11, step: 26, seed: 0.6 },
  { cx: 470, cy: 600, rings: 13, step: 28, seed: 2.1 },
  { cx: 520, cy: 120, rings: 5, step: 22, seed: 4.2 },
];

export function ContourMap() {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {PEAKS.flatMap((peak) =>
        Array.from({ length: peak.rings }, (_, index) => (
          <path
            key={`${peak.seed}-${index}`}
            d={ring(
              peak.cx,
              peak.cy,
              14 + index * peak.step,
              peak.seed + index * 0.35,
            )}
            fill="none"
            stroke="#8fb3a1"
            strokeOpacity={index % 5 === 4 ? 0.75 : 0.32}
            strokeWidth={index % 5 === 4 ? 1.6 : 1}
          />
        )),
      )}
    </svg>
  );
}
