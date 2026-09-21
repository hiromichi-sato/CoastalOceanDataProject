// Finite-volume harmonic interpolation, solved with Numeric.js sparse LU.
export function solveDiffusion(grid, numeric) {
  const { cols, rows, water, anchors, dx, dy, east, south } = grid;
  const n = cols * rows;
  const links = (i) => {
    const x = i % cols, y = Math.floor(i / cols), out = [];
    if (x + 1 < cols && water[i + 1] && (!east || east[i])) out.push([i + 1, 1 / dx ** 2]);
    if (x > 0 && water[i - 1] && (!east || east[i - 1])) out.push([i - 1, 1 / dx ** 2]);
    if (y + 1 < rows && water[i + cols] && (!south || south[i])) out.push([i + cols, 1 / dy ** 2]);
    if (y > 0 && water[i - cols] && (!south || south[i - cols])) out.push([i - cols, 1 / dy ** 2]);
    return out;
  };
  const fixed = new Map(anchors.map(([i, value]) => [i, value]));
  const active = new Set();
  const queue = [...fixed.keys()].filter((i) => water[i]);
  queue.forEach((i) => active.add(i));
  for (let k = 0; k < queue.length; k++) for (const [j] of links(queue[k])) if (!active.has(j)) { active.add(j); queue.push(j); }
  const unknown = [...active].filter((i) => !fixed.has(i)).sort((a, b) => a - b);
  const ids = new Map(unknown.map((i, k) => [i, k]));
  const ri = [], ci = [], coefficients = [], rhs = Array(unknown.length).fill(0);
  unknown.forEach((i, row) => {
    let diagonal = 0;
    for (const [j, w] of links(i)) {
      diagonal += w;
      if (fixed.has(j)) rhs[row] += w * fixed.get(j);
      else { ri.push(row); ci.push(ids.get(j)); coefficients.push(-w); }
    }
    ri.push(row); ci.push(row); coefficients.push(diagonal);
  });
  const values = Array(n).fill(null);
  for (const [i, v] of fixed) if (water[i]) values[i] = v;
  const constant = anchors.length && anchors.every(([,v])=>v===anchors[0][1]);
  if (constant) unknown.forEach((i)=>{ values[i]=anchors[0][1]; });
  else if (unknown.length) {
    const matrix = numeric.ccsScatter([ri, ci, coefficients]);
    const solution = numeric.ccsLUPSolve(numeric.ccsLUP(matrix), rhs);
    unknown.forEach((i, k) => { values[i] = solution[k]; });
  }
  let residual = 0;
  for (const i of unknown) {
    let error = 0, weight = 0;
    for (const [j, w] of links(i)) { error += w * (values[i] - values[j]); weight += w; }
    residual = Math.max(residual, Math.abs(error) / weight);
  }
  const scale = Math.max(1, ...anchors.map(([, v]) => Math.abs(v)));
  if (!Number.isFinite(residual) || residual > 1e-7 * scale || [...active].some((i) => !Number.isFinite(values[i]))) throw new Error('拡散方程式の求解残差が許容値を超えました。');
  const low = Math.min(...anchors.map(([,v])=>v)), high = Math.max(...anchors.map(([,v])=>v));
  if ([...active].some((i)=>values[i]<low-1e-7*scale || values[i]>high+1e-7*scale)) throw new Error('拡散補間の最大値原理を満たしません。');
  return { values, residual, solvedCells: active.size, unconstrainedCells: water.filter(Boolean).length - active.size };
}
