import React, { useMemo, useState } from "react";

/* ============================ Helpers ============================ */
const toRoman = (num: number) => {
  if (num <= 0) return "";
  const romans: [number, string][] = [
    [1000, "M"],[900, "CM"],[500, "D"],[400, "CD"],[100, "C"],[90, "XC"],[50, "L"],[40, "XL"],[10, "X"],[9, "IX"],[5, "V"],[4, "IV"],[1, "I"],
  ];
  let n = num; let out = "";
  for (const [v, s] of romans) { while (n >= v) { out += s; n -= v; } }
  return out;
};

/* ======================= Epsilon arithmetic ======================= */
interface EpsilonValue { base: number; epsilon: number; }

const parseEpsilonValue = (input: string | number): EpsilonValue => {
  if (typeof input === "number") return { base: input, epsilon: 0 };
  const str = (input ?? "").toString().trim();
  if (!str) return { base: 0, epsilon: 0 };

  // "10 + ε", "5- e", "7+2ε"
  const pattern = /^(-?\d*\.?\d+)\s*([+-])\s*(\d*\.?\d*)\s*([eεEЕ])?$/;
  const m = str.match(pattern);
  if (m) {
    const base = parseFloat(m[1]);
    const sign = m[2] === "+" ? 1 : -1;
    const coeff = m[3] ? parseFloat(m[3]) : 1;
    return { base, epsilon: sign * coeff };
  }
  // число
  if (/^-?\d*\.?\d+$/.test(str)) return { base: parseFloat(str), epsilon: 0 };
  // только ε
  const m2 = str.match(/^([+-])?(\d*\.?\d*)\s*([eεEЕ])$/);
  if (m2) {
    const sign = m2[1] === "-" ? -1 : 1;
    const coeff = m2[2] ? parseFloat(m2[2]) : 1;
    return { base: 0, epsilon: sign * coeff };
  }
  return { base: 0, epsilon: 0 };
};
const formatEpsilonValue = (v: EpsilonValue): string => {
  const b = v.base, e = v.epsilon;
  if (e === 0) return b.toString();
  let s = b !== 0 ? b.toString() : "";
  if (e > 0) s += (s ? " + " : "") + (e === 1 ? "ε" : `${e}ε`);
  else if (e < 0) s += (s ? " - " : "-") + (Math.abs(e) === 1 ? "ε" : `${Math.abs(e)}ε`);
  return s || "0";
};
const compareEpsilonValues = (a: EpsilonValue, b: EpsilonValue) => {
  const EPS = 1e-10;
  const aa = a.base + a.epsilon * EPS;
  const bb = b.base + b.epsilon * EPS;
  return aa - bb;
};
const minEpsilonValue = (a: EpsilonValue, b: EpsilonValue) =>
  compareEpsilonValues(a, b) <= 0 ? a : b;
const addE = (a: EpsilonValue, b: EpsilonValue): EpsilonValue => ({ base: a.base + b.base, epsilon: a.epsilon + b.epsilon });
const subE = (a: EpsilonValue, b: EpsilonValue): EpsilonValue => ({ base: a.base - b.base, epsilon: a.epsilon - b.epsilon });
const mulE = (a: EpsilonValue, k: number): EpsilonValue => ({ base: a.base * k, epsilon: a.epsilon * k });
const isZeroE = (a: EpsilonValue) => a.base === 0 && a.epsilon === 0;

/* ============================== Types ============================== */
interface StepSnapshot {
  stepIndex: number;
  i: number; j: number;
  placed: EpsilonValue;
  remainingSupplies: EpsilonValue[];
  remainingDemands: EpsilonValue[];
  alloc: EpsilonValue[][];
  exhaustedRows: boolean[];
  exhaustedCols: boolean[];
  totalCost: EpsilonValue;
}

interface PotentialsSnapshot {
  iter: number;
  allocBefore: EpsilonValue[][]; // состояние ДО применения θ
  allocAfter: EpsilonValue[][];  // состояние ПОСЛЕ применения θ
  u: number[];     // справа
  v: number[];     // снизу
  vu: number[][];  // v_j - u_i
  delta: number[][]; // c_ij - (v_j - u_i)
  entering?: { i: number; j: number } | null;
  cycle?: { [key: string]: "+" | "-" }; // "i,j" -> sign
  theta?: EpsilonValue;
  totalCostBefore: EpsilonValue;
  totalCostAfter: EpsilonValue;
}

/* ====================== Utilities for matrices ===================== */
const epsilonZeros = (m: number, n: number): EpsilonValue[][] =>
  Array.from({ length: m }, () => Array.from({ length: n }, () => ({ base: 0, epsilon: 0 })));

const cloneAlloc = (A: EpsilonValue[][]) => A.map(r => r.map(c => ({ ...c })));
const allocSumRow = (A: EpsilonValue[][], i: number) =>
  A[i].reduce((s, x) => addE(s, x), { base: 0, epsilon: 0 });
const allocSumCol = (A: EpsilonValue[][], j: number) =>
  A.reduce((s, r) => addE(s, r[j]), { base: 0, epsilon: 0 });

/* ===================== NW-corner (дано у тебя) ===================== */
function computeNW(costs: number[][], suppliesInit: EpsilonValue[], demandsInit: EpsilonValue[]): StepSnapshot[] {
  const m = suppliesInit.length, n = demandsInit.length;
  const supplies = suppliesInit.map(s => ({ ...s }));
  const demands = demandsInit.map(d => ({ ...d }));
  const alloc = epsilonZeros(m, n);
  const steps: StepSnapshot[] = [];
  let i = 0, j = 0, step = 0;
  let totalCost: EpsilonValue = { base: 0, epsilon: 0 };
  const totalSteps = m + n - 1;

  while (i < m && j < n && step < 10_000) {
    const take = minEpsilonValue(supplies[i], demands[j]);
    alloc[i][j] = addE(alloc[i][j], take);
    supplies[i] = subE(supplies[i], take);
    demands[j] = subE(demands[j], take);
    totalCost = addE(totalCost, mulE(take, costs[i][j]));

    steps.push({
      stepIndex: ++step,
      i, j,
      placed: { ...take },
      remainingSupplies: supplies.map(s => ({ ...s })),
      remainingDemands: demands.map(d => ({ ...d })),
      alloc: cloneAlloc(alloc),
      exhaustedRows: [], exhaustedCols: [],
      totalCost: { ...totalCost },
    });

    const rowDone = isZeroE(supplies[i]);
    const colDone = isZeroE(demands[j]);
    if (rowDone && colDone) { i += 1; j += 1; }
    else if (rowDone) { i += 1; }
    else if (colDone) { j += 1; }
    else break;

    if (step >= totalSteps) break;
  }
  return steps;
}

/* ===================== Potentials method logic ===================== */

/** Собираем базис: ячейки с ненулевой отгрузкой считаем базисом (ε>0 — тоже базис). */
const buildBasis = (alloc: EpsilonValue[][]) => {
  const m = alloc.length, n = alloc[0].length;
  const basis: boolean[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => !isZeroE(alloc[i][j]))
  );
  return basis;
};

/** Считаем потенциалы u, v из базиса. Берём u[0]=0 и распространяем. */
const computeUV = (costs: number[][], alloc: EpsilonValue[][]): { u: number[]; v: number[] } => {
  const m = costs.length, n = costs[0].length;
  const basis = buildBasis(alloc);

  const u: (number | null)[] = Array(m).fill(null);
  const v: (number | null)[] = Array(n).fill(null);
  u[0] = 0;

  // BFS по базисным рёбрам
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (!basis[i][j]) continue;
        if (u[i] !== null && v[j] === null) { v[j] = (u[i] as number) + costs[i][j]; changed = true; }
        else if (u[i] === null && v[j] !== null) { u[i] = (v[j] as number) - costs[i][j]; changed = true; }
      }
    }
  }

  // fallback если вдруг что-то не связалось (бывает при нулевых/альтернативных базисах)
  for (let i = 0; i < m; i++) if (u[i] === null) u[i] = 0;
  for (let j = 0; j < n; j++) if (v[j] === null) v[j] = costs[0][j]; // не важно — δ посчитается корректно up to shift

  return { u: u as number[], v: v as number[] };
};

/** Считаем v-u и δ = c - (v-u) для всех клеток. */
const computeVUAndDelta = (costs: number[][], u: number[], v: number[]) => {
  const m = costs.length, n = costs[0].length;
  const vu: number[][] = Array.from({ length: m }, () => Array(n).fill(0));
  const delta: number[][] = Array.from({ length: m }, () => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      vu[i][j] = v[j] - u[i];
      delta[i][j] = costs[i][j] - vu[i][j];
    }
  }
  return { vu, delta };
};

/** Находим небазисную ячейку с минимальной δ (самая отрицательная). */
const chooseEntering = (alloc: EpsilonValue[][], delta: number[][]) => {
  const m = alloc.length, n = alloc[0].length;
  let best: { i: number; j: number; val: number } | null = null;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (!isZeroE(alloc[i][j])) continue; // базис — пропускаем
      const d = delta[i][j];
      if (d < -1e-12 && (best === null || d < best.val)) {
        best = { i, j, val: d };
      }
    }
  }
  return best ? { i: best.i, j: best.j } : null;
};

/** По входящей ячейке строим прямоугольный цикл по базису (ортогональные ходы). */
const findCycle = (alloc: EpsilonValue[][], enter: { i: number; j: number }) => {
  const m = alloc.length, n = alloc[0].length;
  const basis = buildBasis(alloc);
  const [si, sj] = [enter.i, enter.j];

  // DFS с чередованием: row -> col -> row -> ...
  // Храним путь как список координат; стартовая точка повторяется в конце.
  type Node = { i: number; j: number };
  const key = (i: number, j: number) => `${i},${j}`;

  const visited = new Set<string>();
  const stack: Node[] = [{ i: si, j: sj }];

  // Ищем цикл: выбираем любые базисные точки в той же строке/столбце по очереди
  const dfs = (node: Node, lookForRow: boolean): Node[] | null => {
    const k = key(node.i, node.j);
    visited.add(k);

    // список соседей: если ищем в строке — базисы в этой строке с иным столбцом; если в столбце — базисы в этом столбце с иным рядом
    const neighbors: Node[] = [];
    if (lookForRow) {
      for (let jj = 0; jj < n; jj++) {
        if (jj === node.j) continue;
        if (basis[node.i][jj] || (node.i === si && jj === sj)) neighbors.push({ i: node.i, j: jj });
      }
    } else {
      for (let ii = 0; ii < m; ii++) {
        if (ii === node.i) continue;
        if (basis[ii][node.j] || (ii === si && node.j === sj)) neighbors.push({ i: ii, j: node.j });
      }
    }

    for (const nb of neighbors) {
      const kk = key(nb.i, nb.j);
      if (nb.i === si && nb.j === sj && stack.length >= 4) {
        // нашли возврат к старту: цикл готов
        return [...stack, nb];
      }
      if (visited.has(kk)) continue;
      stack.push(nb);
      const res = dfs(nb, !lookForRow);
      if (res) return res;
      stack.pop();
    }
    visited.delete(k);
    return null;
  };

  // Стартуем: после входа идём по строке (или по столбцу — не важно, но классически — по строке)
  const path = dfs({ i: si, j: sj }, true);
  if (!path) return null;

  // Проставим знаки + / − на цикле, начиная с входящей (+), далее попеременно
  const marks: { [key: string]: "+" | "-" } = {};
  for (let idx = 0; idx < path.length; idx++) {
    const p = path[idx];
    marks[key(p.i, p.j)] = idx % 2 === 0 ? "+" : "-";
  }
  return { cyclePath: path, marks };
};

/** Находим θ = min по ячейкам с минусом на цикле; применяем перенос. */
const applyThetaOnCycle = (
  alloc: EpsilonValue[][],
  marks: { [key: string]: "+" | "-" },
  theta: EpsilonValue
) => {
  const A = cloneAlloc(alloc);
  const m = A.length, n = A[0].length;
  const key = (i: number, j: number) => `${i},${j}`;

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const mark = marks[key(i, j)];
      if (!mark) continue;
      if (mark === "+") A[i][j] = addE(A[i][j], theta);
      else A[i][j] = subE(A[i][j], theta);
      // защита от -0+ε и пр. — «зачищаем» очень малые базы
      if (Math.abs(A[i][j].base) < 1e-12) A[i][j].base = 0;
      if (Math.abs(A[i][j].epsilon) < 1e-12) A[i][j].epsilon = 0;
    }
  }
  return A;
};

/** Текущая стоимость Z(alloc). */
const computeTotalCost = (alloc: EpsilonValue[][], costs: number[][]): EpsilonValue => {
  const m = alloc.length, n = alloc[0].length;
  let Z: EpsilonValue = { base: 0, epsilon: 0 };
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++)
    if (!isZeroE(alloc[i][j])) Z = addE(Z, mulE(alloc[i][j], costs[i][j]));
  return Z;
};

/** Одна итерация метода потенциалов. Возвращает снапшот. */
const potentialsIteration = (
  costs: number[][],
  alloc: EpsilonValue[][]
): PotentialsSnapshot => {
  const { u, v } = computeUV(costs, alloc);
  const { vu, delta } = computeVUAndDelta(costs, u, v);

  // выбираем входящую
  const enter = chooseEntering(alloc, delta);
  const totalCostBefore = computeTotalCost(alloc, costs);

  if (!enter) {
    // оптимально
    return {
      iter: 0,
      allocBefore: cloneAlloc(alloc),
      allocAfter: cloneAlloc(alloc),
      u, v, vu, delta,
      entering: null,
      cycle: undefined,
      theta: undefined,
      totalCostBefore,
      totalCostAfter: totalCostBefore,
    };
  }

  // строим цикл
  const cyc = findCycle(alloc, enter);
  if (!cyc) {
    // на всякий случай — теоретически цикл должен всегда находиться
    return {
      iter: 0,
      allocBefore: cloneAlloc(alloc),
      allocAfter: cloneAlloc(alloc),
      u, v, vu, delta,
      entering: enter,
      cycle: undefined,
      theta: undefined,
      totalCostBefore,
      totalCostAfter: totalCostBefore,
    };
  }

  // θ — минимум по «минусам»
  const negatives: EpsilonValue[] = [];
  for (const [k, sign] of Object.entries(cyc.marks)) {
    if (sign !== "-") continue;
    const [ii, jj] = k.split(",").map(Number);
    negatives.push(alloc[ii][jj]);
  }
  let theta = negatives[0];
  for (let t = 1; t < negatives.length; t++) theta = minEpsilonValue(theta, negatives[t]);

  // перенос
  const nextAlloc = applyThetaOnCycle(alloc, cyc.marks, theta);
  const nextZ = computeTotalCost(nextAlloc, costs);

  return {
    iter: 0,
    allocBefore: cloneAlloc(alloc),
    allocAfter: nextAlloc,
    u, v, vu, delta,
    entering: enter,
    cycle: cyc.marks,
    theta,
    totalCostBefore,
    totalCostAfter: nextZ,
  };
};

/* ============================ UI Helpers ============================ */
const th = (txt: React.ReactNode, extra = "", key?: React.Key) => (
  <th key={key} className={`px-1 sm:px-3 py-1 sm:py-2 text-center text-xs sm:text-sm font-semibold border border-gray-400 ${extra}`}>{txt}</th>
);
const td = (txt: React.ReactNode, extra = "", key?: React.Key) => (
  <td key={key} className={`px-1 sm:px-3 py-1 sm:py-2 text-center text-xs sm:text-sm border border-gray-400 ${extra}`}>{txt}</td>
);

/* ============================== Demo defaults ============================== */
const defaultM = 3, defaultN = 4;
const defaultCosts = Array.from({ length: defaultM }, () => Array(defaultN).fill(0));
const defaultSupplies: EpsilonValue[] = Array(defaultM).fill(null).map(() => ({ base: 0, epsilon: 0 }));
const defaultDemands: EpsilonValue[] = Array(defaultN).fill(null).map(() => ({ base: 0, epsilon: 0 }));

/* ============================== Component ============================== */
export default function NWCornerStepper() {
  const [m, setM] = useState<number>(defaultM);
  const [n, setN] = useState<number>(defaultN);
  const [costs, setCosts] = useState<number[][]>(defaultCosts);
  const [supplies, setSupplies] = useState<EpsilonValue[]>(defaultSupplies);
  const [demands, setDemands] = useState<EpsilonValue[]>(defaultDemands);
  const [suppliesInput, setSuppliesInput] = useState<string[]>(Array(defaultM).fill(""));
  const [demandsInput, setDemandsInput] = useState<string[]>(Array(defaultN).fill(""));

  // NW steps
  const [steps, setSteps] = useState<StepSnapshot[]>([]);
  const [cursor, setCursor] = useState(0);
  const current = steps[cursor];

  // Potentials steps
  const [potSteps, setPotSteps] = useState<PotentialsSnapshot[]>([]);
  const [potCursor, setPotCursor] = useState(0);
  const [showBefore, setShowBefore] = useState(true); // true = до применения θ, false = после
  const pot = potSteps[potCursor];

  const canPrev = cursor > 0;
  const canNext = cursor < Math.max(0, steps.length - 1);
  const canPotPrev = potCursor > 0;
  const canPotNext = potCursor < Math.max(0, potSteps.length - 1);

  const totalSteps = useMemo(() => supplies.length + demands.length - 1, [supplies, demands]);

  const ensureShape = (mm: number, nn: number) => {
    setCosts(prev => Array.from({ length: mm }, (_, i) => Array.from({ length: nn }, (_, j) => prev[i]?.[j] ?? 0)));
    setSupplies(prev => Array.from({ length: mm }, (_, i) => prev[i] ?? { base: 0, epsilon: 0 }));
    setDemands(prev  => Array.from({ length: nn }, (_, j) => prev[j] ?? { base: 0, epsilon: 0 }));
    setSuppliesInput(prev => Array.from({ length: mm }, (_, i) => prev[i] ?? ""));
    setDemandsInput(prev => Array.from({ length: nn }, (_, j) => prev[j] ?? ""));
  };

  const handleSizeChange = (mm: number, nn: number) => {
    setM(mm); setN(nn); ensureShape(mm, nn);
    setSteps([]); setCursor(0);
    setPotSteps([]); setPotCursor(0);
    setShowBefore(true);
  };

  const recomputeNW = () => {
    const s = computeNW(costs, supplies, demands);
    setSteps(s);
    setCursor(s.length ? 0 : 0); // показываем первый шаг
    setPotSteps([]); setPotCursor(0);
    setShowBefore(true);
  };

  const startPotentialsFromNW = () => {
    if (steps.length === 0) return;
    // стартовая опора — последняя NW-матрица (финальный шаг)
    const finalStep = steps[steps.length - 1];
    const startAlloc = cloneAlloc(finalStep.alloc);

    // делаем итерации до оптимальности (ограничим, чтобы не зациклиться)
    const maxIters = 50;
    const arr: PotentialsSnapshot[] = [];
    let A = startAlloc;
    for (let it = 1; it <= maxIters; it++) {
      const snap = potentialsIteration(costs, A);
      // сохраняем снапшот (с номером)
      arr.push({ ...snap, iter: it });
      A = snap.allocAfter;

      // если entering=null (оптимально) — стоп
      if (!snap.entering) break;
    }
    setPotSteps(arr);
    setPotCursor(0);
    setShowBefore(true);
  };

  const resetAll = () => {
    setM(defaultM); setN(defaultN);
    setCosts(Array.from({ length: defaultM }, () => Array(defaultN).fill(0)));
    setSupplies(Array(defaultM).fill(null).map(() => ({ base: 0, epsilon: 0 })));
    setDemands(Array(defaultN).fill(null).map(() => ({ base: 0, epsilon: 0 })));
    setSuppliesInput(Array(defaultM).fill(""));
    setDemandsInput(Array(defaultN).fill(""));
    setSteps([]); setCursor(0);
    setPotSteps([]); setPotCursor(0);
  };

  const demandLabels = Array.from({ length: n }, (_, j) => `T${j+1}`);
  const supplyLabels = Array.from({ length: m }, (_, i) => `S${i+1}`);

  /* ============================== RENDER ============================== */
  return (
    <div className="p-2 sm:p-4 max-w-[1400px] mx-auto">
      <h1 className="text-lg sm:text-2xl font-bold mb-2 sm:mb-4">I. Выбор опорного плана (северо-западный угол, с ε)</h1>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 items-start mb-2 sm:mb-4">
        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border">
          <div className="font-semibold mb-2 text-sm sm:text-base">Размеры</div>
          <div className="flex gap-2 sm:gap-3 items-end">
            <div>
              <label className="block text-xs mb-1">Поставщики (m)</label>
              <input type="number" min={1} value={m}
                onChange={e => handleSizeChange(Math.max(1, +e.target.value), n)}
                className="border rounded px-2 py-1 w-16 sm:w-24 text-sm" />
            </div>
            <div>
              <label className="block text-xs mb-1">Потребители (n)</label>
              <input type="number" min={1} value={n}
                onChange={e => handleSizeChange(m, Math.max(1, +e.target.value))}
                className="border rounded px-2 py-1 w-16 sm:w-24 text-sm" />
            </div>
            <button onClick={resetAll} className="ml-auto px-2 sm:px-3 py-1 sm:py-2 rounded border hover:bg-gray-50 text-xs sm:text-sm">Сброс</button>
          </div>
        </div>

        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border">
          <div className="font-semibold mb-2 text-sm sm:text-base">Запасы A<sub>i</sub> (поддерживается ε)</div>
          <div className="flex flex-wrap gap-1 sm:gap-2">
            {supplies.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-4 sm:w-6">A{i+1}</span>
                <input
                  type="text"
                  value={suppliesInput[i]}
                  placeholder="10+ε"
                  onChange={e => {
                    const nextI = suppliesInput.slice(); nextI[i] = e.target.value; setSuppliesInput(nextI);
                    const nextS = supplies.slice(); nextS[i] = parseEpsilonValue(e.target.value); setSupplies(nextS);
                    setSteps([]); setPotSteps([]);
                  }}
                  className="border rounded px-1 sm:px-2 py-1 w-16 sm:w-24 text-xs sm:text-sm"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border">
          <div className="font-semibold mb-2 text-sm sm:text-base">Потребности B<sub>j</sub> (поддерживается ε)</div>
          <div className="flex flex-wrap gap-1 sm:gap-2">
            {demands.map((v, j) => (
              <div key={j} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-4 sm:w-6">B{j+1}</span>
                <input
                  type="text"
                  value={demandsInput[j]}
                  placeholder="5-ε"
                  onChange={e => {
                    const nextI = demandsInput.slice(); nextI[j] = e.target.value; setDemandsInput(nextI);
                    const nextD = demands.slice(); nextD[j] = parseEpsilonValue(e.target.value); setDemands(nextD);
                    setSteps([]); setPotSteps([]);
                  }}
                  className="border rounded px-1 sm:px-2 py-1 w-16 sm:w-24 text-xs sm:text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cost matrix editor */}
      <div className="p-2 sm:p-3 rounded-lg shadow bg-white border mb-2 sm:mb-4 overflow-x-auto">
        <div className="font-semibold mb-2 text-sm sm:text-base">Тарифы (стоимости) c<sub>ij</sub></div>
        <table className="border-collapse min-w-full">
          <thead>
            <tr>
              {th("", "text-xs sm:text-sm")}
              {demandLabels.map((b, j) => th(b, "text-xs sm:text-sm", `demand-head-${j}`))}
            </tr>
          </thead>
          <tbody>
            {costs.map((row, i) => (
              <tr key={`cost-row-${i}`}>
                {td(`S${i+1}`, "font-medium bg-gray-50 text-xs sm:text-sm")}
                {row.map((val, j) => (
                  <td key={`cost-cell-${i}-${j}`} className="px-1 py-1 border border-gray-400">
                    <input
                      type="number"
                      value={val === 0 ? "" : val}
                      onChange={e => {
                        const next = costs.map(r => r.slice());
                        next[i][j] = e.target.value === "" ? 0 : +e.target.value;
                        setCosts(next); setSteps([]); setPotSteps([]);
                      }}
                      className="border rounded px-1 sm:px-2 py-1 w-10 sm:w-16 text-center text-xs sm:text-sm"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* NW Action bar */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <button onClick={recomputeNW} className="px-3 sm:px-4 py-2 rounded bg-blue-600 text-white shadow hover:bg-blue-700 text-xs sm:text-sm">Рассчитать NW</button>
        <button disabled={!canPrev} onClick={() => setCursor(c => Math.max(0, c-1))}
                className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${canPrev?"hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>← Назад</button>
        <button disabled={!canNext} onClick={() => setCursor(c => Math.min(steps.length-1, c+1))}
                className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${canNext?"hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>Вперёд →</button>
        <button disabled={steps.length === 0 || cursor !== steps.length - 1} onClick={startPotentialsFromNW} className={`px-3 sm:px-4 py-2 rounded bg-violet-600 text-white shadow text-xs sm:text-sm ${steps.length > 0 && cursor === steps.length - 1 ? "hover:bg-violet-700" : "opacity-50 cursor-not-allowed"}`}>
          II. Запустить оптимизацию (потенциалы)
        </button>
        {current && (
          <div className="ml-2 text-xs sm:text-sm text-gray-700 break-words">
            Шаг <b>{current.stepIndex}</b> / {steps.length} — ячейка: <b>S{current.i+1}→T{current.j+1}</b>, отгрузка: <b>{formatEpsilonValue(current.placed)}</b>
            {cursor === steps.length - 1 && steps.length > 0 && (
              <span className="ml-2 text-green-600 font-semibold">✓ NW завершён, можно запускать оптимизацию</span>
            )}
          </div>
        )}
      </div>

      {/* Main residuals table - combined format */}
      {steps.length > 0 && current && (
        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border mb-2 sm:mb-4 overflow-x-auto">
          <div className="font-semibold mb-3 text-sm sm:text-base">Таблица остатков по шагам (до шага {current.stepIndex})</div>
          <table className="border-collapse border-2 border-gray-800 min-w-full">
            <thead>
              <tr>
                {th("NW", "bg-gray-100 font-bold text-xs sm:text-sm")}
                {demandLabels.map((b, j) => th(b, "bg-gray-100 text-xs sm:text-sm", `th-demand-${j}`))}
                {th("A", "bg-gray-100 font-bold text-xs sm:text-sm")}
                {Array.from({ length: cursor + 1 }, (_, k) => th(toRoman(k + 1), "bg-blue-50 text-xs sm:text-sm", `th-roman-${k}`))}
              </tr>
            </thead>
            <tbody>
              {/* Supply rows */}
              {supplyLabels.map((lbl, i) => (
                <tr key={`supply-row-${i}`}>
                  {td(lbl, "font-bold bg-gray-100 text-xs sm:text-sm")}
                  {demandLabels.map((_, j) => {
                    const placed = current.alloc[i][j];
                    const isActive = current && current.i === i && current.j === j;
                    return (
                      <td key={`allocation-cell-${i}-${j}`} className={`px-1 sm:px-2 py-1 text-center border border-gray-400 ${isActive?"bg-yellow-200" : "bg-white"}`}>
                        <div className="font-semibold text-sm sm:text-lg">{isZeroE(placed) ? "" : formatEpsilonValue(placed)}</div>
                      </td>
                    );
                  })}
                  {td(formatEpsilonValue(supplies[i]), "bg-yellow-50 font-semibold text-xs sm:text-sm")}
                  {Array.from({ length: cursor + 1 }, (_, k) => {
                    const val = steps[k]?.remainingSupplies?.[i] ?? { base: 0, epsilon: 0 };
                    return td(formatEpsilonValue(val), `text-xs sm:text-sm ${isZeroE(val) ? "bg-gray-100 text-gray-400" : ""}`, `supply-res-${i}-${k}`);
                  })}
                </tr>
              ))}
              
              {/* B row (demands initial) */}
              <tr>
                {td("B", "font-bold bg-gray-100 text-xs sm:text-sm")}
                {demands.map((d, j) => td(formatEpsilonValue(d), "bg-yellow-50 font-semibold text-xs sm:text-sm", `b-init-${j}`))}
                {td("", "bg-gray-100")}
                {Array.from({ length: cursor + 1 }, (_, k) => td("", "bg-gray-50", `b-spacer-${k}`))}
              </tr>

              {/* Demand residual rows */}
              {Array.from({ length: cursor + 1 }, (_, k) => (
                <tr key={`demand-residual-row-${k}`}>
                  {td(toRoman(k + 1), "font-bold bg-blue-50 text-xs sm:text-sm")}
                  {demandLabels.map((_, j) => {
                    const val = steps[k]?.remainingDemands?.[j] ?? { base: 0, epsilon: 0 };
                    return td(formatEpsilonValue(val), `text-xs sm:text-sm ${isZeroE(val) ? "bg-gray-100 text-gray-400" : ""}`, `demand-res-${k}-${j}`);
                  })}
                  {td("", "bg-gray-100")}
                  {Array.from({ length: cursor + 1 }, (_, kk) => td("", "bg-gray-50", `spacer-${k}-${kk}`))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Final Allocation matrix - only on last step */}
      {current && cursor === steps.length - 1 && (
        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border mb-4 overflow-x-auto">
          <div className="font-semibold mb-2 text-sm sm:text-base">Итоговая матрица распределений (NW завершён)</div>
          <table className="border-collapse border-2 border-gray-800 min-w-full">
            <thead>
              <tr>
                {th("", "text-xs sm:text-sm")}
                {demandLabels.map((b, j) => th(b, "text-xs sm:text-sm"))}
                {th("Σ", "text-xs sm:text-sm")}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: m }, (_, i) => (
                <tr key={`final-alloc-row-${i}`}>
                  {td(`S${i+1}`, "font-bold bg-gray-100 text-xs sm:text-sm")}
                  {Array.from({ length: n }, (_, j) => {
                    const placed = current.alloc[i][j];
                    return (
                      <td key={`final-alloc-cell-${i}-${j}`} className="px-1 sm:px-2 py-1 text-center border border-gray-400 bg-white">
                        <div className="text-[11px] text-gray-500">c={costs[i][j]}</div>
                        <div className="font-semibold text-sm sm:text-lg">{isZeroE(placed) ? "" : formatEpsilonValue(placed)}</div>
                      </td>
                    );
                  })}
                  {td(formatEpsilonValue(allocSumRow(current.alloc, i)), "font-bold bg-gray-100 text-xs sm:text-sm")}
                </tr>
              ))}
              <tr>
                {td("Σ", "font-bold bg-gray-100 text-xs sm:text-sm")}
                {Array.from({ length: n }, (_, j) => td(formatEpsilonValue(allocSumCol(current.alloc, j)), "font-bold bg-gray-100 text-xs sm:text-sm"))}
                {td(`Z = ${formatEpsilonValue(current.totalCost)}`, "font-bold bg-green-100 text-xs sm:text-sm")}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ======================== II. Потенциалы ======================== */}
      {potSteps.length > 0 && pot && (
        <div className="p-2 sm:p-3 rounded-lg shadow bg-white border overflow-x-auto">
          <h2 className="text-lg sm:text-xl font-bold mb-2">II. Оптимизация опорного плана методом потенциалов</h2>

          {/* Potentials toolbar */}
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <button disabled={!canPotPrev} onClick={() => setPotCursor(c => Math.max(0, c - 1))}
              className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${canPotPrev ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"}`}>
              ← Назад
            </button>
            <button disabled={!canPotNext} onClick={() => setPotCursor(c => Math.min(potSteps.length - 1, c + 1))}
              className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${canPotNext ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"}`}>
              Вперёд →
            </button>
            {pot && pot.entering && (
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowBefore(true)}
                  className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${showBefore ? "bg-blue-500 text-white" : "hover:bg-gray-50"}`}>
                  До применения θ
                </button>
                <button 
                  onClick={() => setShowBefore(false)}
                  className={`px-2 sm:px-3 py-2 rounded border shadow text-xs sm:text-sm ${!showBefore ? "bg-blue-500 text-white" : "hover:bg-gray-50"}`}>
                  После применения θ
                </button>
              </div>
            )}
            <div className="ml-2 text-xs sm:text-sm text-gray-700">
              <div className="flex flex-wrap gap-4">
                <span>Итерация <b>{potCursor + 1}</b> / {potSteps.length}</span>
                {pot && pot.entering && <span>Входящая: <b>S{pot.entering.i + 1}→T{pot.entering.j + 1}</b></span>}
                {pot && pot.theta && <span>θ = <b>{formatEpsilonValue(pot.theta)}</b></span>}
                <span>Z = <b>{formatEpsilonValue(pot ? (showBefore ? pot.totalCostBefore : pot.totalCostAfter) : { base: 0, epsilon: 0 })}</b></span>
                {pot && !pot.entering && <span className="text-green-600 font-bold">✓ ОПТИМАЛЬНО</span>}
              </div>
            </div>
          </div>

          {/* Potentials table */}
          <div className="mb-3">
            <div className="font-semibold mb-2 text-sm sm:text-base">
              Потенциалы и оценки {pot.entering ? (showBefore ? "(до применения θ)" : "(после применения θ)") : "(оптимальное решение)"}
            </div>
            <table className="border-collapse border-2 border-gray-800 min-w-full">
              <thead>
                <tr>
                  {th("", "bg-gray-100 text-xs sm:text-sm")}
                  {demandLabels.map((b, j) => th(b, "bg-gray-100 font-bold text-xs sm:text-sm"))}
                  {th("u", "bg-gray-100 font-bold text-xs sm:text-sm")}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: m }, (_, i) => (
                  <tr key={`pot-row-${i}`}>
                    {td(`S${i+1}`, "font-bold bg-gray-100 text-xs sm:text-sm")}
                    {Array.from({ length: n }, (_, j) => {
                      const currentAlloc = showBefore ? pot.allocBefore : pot.allocAfter;
                      const inBasis = !isZeroE(currentAlloc[i][j]);
                      const isEnter = pot.entering && pot.entering.i === i && pot.entering.j === j;
                      const mark = pot.cycle?.[`${i},${j}`]; // "+" | "-" | undefined
                      const cellClass =
                        isEnter && showBefore ? "bg-yellow-200" :
                        mark === "+" && !showBefore ? "bg-green-100" :
                        mark === "-" && !showBefore ? "bg-red-100" : 
                        inBasis ? "bg-white" : "bg-gray-50";

                      return (
                        <td key={`pot-cell-${i}-${j}`} className={`relative px-3 py-3 border border-gray-400 ${cellClass} min-w-[80px] min-h-[60px]`}>
                          {!inBasis && showBefore && (
                            <>
                              <div className="absolute left-1 top-1 text-[10px] font-semibold text-red-600">
                                δ={pot.delta[i][j].toFixed(0)}
                              </div>
                              <div className="absolute left-1 bottom-1 text-[10px] text-blue-600">
                                {pot.vu[i][j].toFixed(0)}
                              </div>
                            </>
                          )}
                          {inBasis && (
                            <div className="absolute left-1 top-1 text-[10px] font-bold text-gray-700">
                              ●
                            </div>
                          )}
                          <div className="absolute right-1 top-1 text-[10px] text-gray-500">
                            c={costs[i][j]}
                          </div>
                          <div className="text-center">
                            <div className="font-bold text-lg text-center mt-4">{isZeroE(currentAlloc[i][j]) ? "" : formatEpsilonValue(currentAlloc[i][j])}</div>
                          </div>
                        </td>
                      );
                    })}
                    {td(pot.u[i].toFixed(0), "font-bold bg-blue-100 text-lg")}
                  </tr>
                ))}
                <tr>
                  {td("v", "font-bold bg-gray-100 text-xs sm:text-sm")}
                  {Array.from({ length: n }, (_, j) => td(pot.v[j].toFixed(0), "font-bold bg-blue-100 text-lg"))}
                  {td("", "bg-gray-100")}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Allocation summary per row/col */}
          <div className="mb-2">
            <div className="font-semibold mb-2 text-sm sm:text-base">
              Итоговая матрица распределений (итерация {pot.iter}) {pot.entering ? (showBefore ? "— до θ" : "— после θ") : ""}
            </div>
            <table className="border-collapse border-2 border-gray-800 min-w-full">
              <thead>
                <tr>
                  {th("", "bg-gray-100 font-bold")}
                  {demandLabels.map((b, j) => th(b, "bg-gray-100 font-bold"))}
                  {th("Σ", "bg-gray-100 font-bold")}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: m }, (_, i) => (
                  <tr key={`sum-row-${i}`}>
                    {td(`S${i+1}`, "bg-gray-50 font-bold")}
                    {Array.from({ length: n }, (_, j) => {
                      const currentAlloc = showBefore ? pot.allocBefore : pot.allocAfter;
                      const value = currentAlloc[i][j];
                      const inBasis = !isZeroE(value);
                      return td(
                        isZeroE(value) ? "" : formatEpsilonValue(value), 
                        `${inBasis ? "font-semibold bg-blue-50" : ""} text-center`
                      );
                    })}
                    {td(formatEpsilonValue(allocSumRow(showBefore ? pot.allocBefore : pot.allocAfter, i)), "bg-gray-50 font-semibold")}
                  </tr>
                ))}
                <tr>
                  {td("Σ", "bg-gray-50 font-semibold")}
                  {Array.from({ length: n }, (_, j) => td(formatEpsilonValue(allocSumCol(showBefore ? pot.allocBefore : pot.allocAfter, j)), "bg-gray-50 font-semibold"))}
                  {td(`Z = ${formatEpsilonValue(showBefore ? pot.totalCostBefore : pot.totalCostAfter)}`, "bg-green-100 font-bold text-lg")}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-xs text-gray-500 mt-2">
            <div className="flex flex-wrap gap-4 mb-2">
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 bg-yellow-200 border border-gray-300"></span>
                Входящая ячейка
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 bg-green-100 border border-gray-300"></span>
                Плюс-позиции цикла
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 bg-red-100 border border-gray-300"></span>
                Минус-позиции цикла
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 bg-blue-100 border border-gray-300"></span>
                Потенциалы u, v
              </span>
            </div>
            <div>
              В небазисных клетках: вверху слева показано <span className="text-red-600 font-semibold">δ</span> (оценка), 
              внизу слева — <span className="text-blue-600 font-semibold">v−u</span>. 
              Базисные клетки отмечены символом ●.
            </div>
          </div>
        </div>
      )}

      {/* Footnote */}
      <div className="text-xs text-gray-500 mt-3">
        <div className="mb-1"><strong>Примечание:</strong> при равных/нулевых оценках возможны альтернативные базисы; компонент корректно обрабатывает ε-ячейки.</div>
      </div>
    </div>
  );
}