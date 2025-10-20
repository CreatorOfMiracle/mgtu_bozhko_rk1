import React, { useMemo, useState } from "react";

/* =================== маленькие компоненты ячеек =================== */
const Th = ({ extra = "", children = null }: { extra?: string; children?: any }) => (
  <th className={`px-1 sm:px-2 py-1 sm:py-2 text-center border text-xs sm:text-sm ${extra}`}>{children}</th>
);
const Td = ({ extra = "", children = null }: { extra?: string; children?: any }) => (
  <td className={`px-1 sm:px-2 py-1 sm:py-2 text-center border text-xs sm:text-sm ${extra}`}>{children}</td>
);

/* ======================= Helpers для римских цифр ======================= */
const toRoman = (num: number): string => {
  if (num <= 0) return "";
  const romans: [number, string][] = [
    [1000, "M"],[900, "CM"],[500, "D"],[400, "CD"],[100, "C"],[90, "XC"],
    [50, "L"],[40, "XL"],[10, "X"],[9, "IX"],[5, "V"],[4, "IV"],[1, "I"],
  ];
  let n = num, out = "";
  for (const [v, s] of romans) { 
    while (n >= v) { out += s; n -= v; } 
  }
  return out;
};

/* =========================== helpers (VAM) ========================== */
function twoSmallest(values: number[]): [number, number] {
  if (values.length === 0) return [Infinity, Infinity];
  if (values.length === 1) return [values[0], values[0]];
  
  // Сортируем копию массива и берем первые два элемента
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[0], sorted[1]];
}

function cloneAlloc(A: Array<Array<{ x: number; penaltyUsed?: number }>>) {
  return A.map(r => r.map(c => ({ ...c })));
}

/** Балансирует задачу, добавляя фиктивного поставщика или потребителя */
function balanceTask(costs: number[][], supplies: number[], demands: number[]) {
  const totalSupply = supplies.reduce((a, b) => a + b, 0);
  const totalDemand = demands.reduce((a, b) => a + b, 0);

  let balancedCosts = costs.map(r => r.slice());
  let balancedSupplies = supplies.slice();
  let balancedDemands = demands.slice();
  let addedSupplier = false;
  let addedConsumer = false;

  if (totalSupply > totalDemand) {
    // Добавляем фиктивного потребителя
    const diff = totalSupply - totalDemand;
    balancedDemands.push(diff);
    balancedCosts = balancedCosts.map(row => [...row, 0]);
    addedConsumer = true;
  } else if (totalDemand > totalSupply) {
    // Добавляем фиктивного поставщика
    const diff = totalDemand - totalSupply;
    balancedSupplies.push(diff);
    balancedCosts.push(Array(balancedDemands.length).fill(0));
    addedSupplier = true;
  }

  return { balancedCosts, balancedSupplies, balancedDemands, addedSupplier, addedConsumer };
}

/** Считает ВСЕ шаги Фогеля (до закрытия задачи) — для пошагового просмотра */
function computeVogelSteps(costs: number[][], s0: number[], d0: number[]) {
  // Балансируем задачу перед расчётом
  const { balancedCosts, balancedSupplies, balancedDemands } = balanceTask(costs, s0, d0);
  
  const m = balancedSupplies.length, n = balancedDemands.length;
  const supplies = balancedSupplies.slice();
  const demands  = balancedDemands.slice();
  const alloc: { x: number; penaltyUsed?: number }[][] = Array.from({ length: m }, () =>
    Array.from({ length: n }, () => ({ x: 0 }))
  );

  const steps: any[] = [];
  let Z = 0, step = 0;

  while (supplies.some(v=>v>0) && demands.some(v=>v>0) && step < 10_000) {
    // штрафы по строкам
    const rowPen = Array(m).fill(-Infinity);
    for (let i=0;i<m;i++) {
      if (supplies[i] === 0) continue;
      const rowCosts = [];
      for (let j=0;j<n;j++) if (demands[j] > 0) rowCosts.push(balancedCosts[i][j]);
      if (rowCosts.length === 0) continue;
      const [a,b] = twoSmallest(rowCosts);
      // штраф = разница между вторым и первым минимальными значениями
      rowPen[i] = rowCosts.length === 1 ? a : (b - a);
    }
    // штрафы по столбцам
    const colPen = Array(n).fill(-Infinity);
    for (let j=0;j<n;j++) {
      if (demands[j] === 0) continue;
      const colCosts = [];
      for (let i=0;i<m;i++) if (supplies[i] > 0) colCosts.push(balancedCosts[i][j]);
      if (colCosts.length === 0) continue;
      const [a,b] = twoSmallest(colCosts);
      // штраф = разница между вторым и первым минимальными значениями
      colPen[j] = colCosts.length === 1 ? a : (b - a);
    }

    // выбираем максимальный штраф
    // Если несколько штрафов одинаковые, выбираем тот, где минимальная стоимость меньше
    let chosenBy = "row";
    let bestIdx = -1, bestPen = -Infinity;
    let bestMinCost = Infinity;
    
    // Сначала находим максимальный штраф
    for (let i=0;i<m;i++) if (isFinite(rowPen[i]) && rowPen[i] > bestPen) { bestPen=rowPen[i]; }
    for (let j=0;j<n;j++) if (isFinite(colPen[j]) && colPen[j] > bestPen) { bestPen=colPen[j]; }
    
    // Теперь среди всех строк/столбцов с максимальным штрафом выбираем тот, где минимальная стоимость меньше
    for (let i=0;i<m;i++) {
      if (isFinite(rowPen[i]) && rowPen[i] === bestPen) {
        // Находим минимальную стоимость в этой строке
        let minCost = Infinity;
        for (let j=0;j<n;j++) {
          if (demands[j] > 0 && balancedCosts[i][j] < minCost) {
            minCost = balancedCosts[i][j];
          }
        }
        // Если эта строка имеет меньшую минимальную стоимость, выбираем её
        if (minCost < bestMinCost) {
          bestMinCost = minCost;
          chosenBy = "row";
          bestIdx = i;
        }
      }
    }
    
    for (let j=0;j<n;j++) {
      if (isFinite(colPen[j]) && colPen[j] === bestPen) {
        // Находим минимальную стоимость в этом столбце
        let minCost = Infinity;
        for (let i=0;i<m;i++) {
          if (supplies[i] > 0 && balancedCosts[i][j] < minCost) {
            minCost = balancedCosts[i][j];
          }
        }
        // Если этот столбец имеет меньшую минимальную стоимость, выбираем его
        if (minCost < bestMinCost) {
          bestMinCost = minCost;
          chosenBy = "col";
          bestIdx = j;
        }
      }
    }
    
    if (bestIdx < 0) break;

    // внутри выбранной строки/столбца берем ячейку с МИНИМАЛЬНОЙ стоимостью
    let selI = 0, selJ = 0;
    if (chosenBy === "row") {
      selI = bestIdx;
      let min = Infinity, arg = -1;
      for (let j=0;j<n;j++) if (demands[j] > 0 && balancedCosts[selI][j] < min) { min = balancedCosts[selI][j]; arg = j; }
      selJ = arg;
    } else {
      selJ = bestIdx;
      let min = Infinity, arg = -1;
      for (let i=0;i<m;i++) if (supplies[i] > 0 && balancedCosts[i][selJ] < min) { min = balancedCosts[i][selJ]; arg = i; }
      selI = arg;
    }

    const taken = Math.min(supplies[selI], demands[selJ]);
    alloc[selI][selJ].x += taken;
    alloc[selI][selJ].penaltyUsed = bestPen;
    supplies[selI] -= taken;
    demands[selJ]  -= taken;
    Z += taken * balancedCosts[selI][selJ];

    steps.push({
      stepIndex: ++step,
      i: selI, j: selJ,
      chosenBy,
      placed: taken,
      rowPen: rowPen.slice(),
      colPen: colPen.slice(),
      alloc: cloneAlloc(alloc),
      suppliesLeft: supplies.slice(),
      demandsLeft: demands.slice(),
      totalCost: Z,
    });
  }

  return steps;
}

/* ====================== дефолтные данные задания ====================== */
const defaultCosts = [
  [10, 7, 6, 8],
  [ 5, 6, 5, 4],
  [ 8, 7, 6, 7],
];
const defaultSupplies = [31, 48, 38];
const defaultDemands  = [22, 34, 41, 20];

/* ============================== компонент ============================== */
export default function VogelStepper() {
  const [m, setM] = useState(3);
  const [n, setN] = useState(4);
  const [costs, setCosts] = useState(defaultCosts);
  const [supplies, setSupplies] = useState(defaultSupplies);
  const [demands, setDemands] = useState(defaultDemands);

  type AllocCell = { x: number; penaltyUsed?: number };
  type Step = {
    stepIndex: number;
    i: number; j: number; chosenBy: string; placed: number;
    rowPen: number[]; colPen: number[];
    alloc: AllocCell[][];
    suppliesLeft: number[]; demandsLeft: number[]; totalCost: number;
  };

  // Проверяем балансировку
  const totalSupply = useMemo(() => supplies.reduce((a, b) => a + b, 0), [supplies]);
  const totalDemand = useMemo(() => demands.reduce((a, b) => a + b, 0), [demands]);
  const isBalanced = totalSupply === totalDemand;
  const balanceInfo = useMemo(() => balanceTask(costs, supplies, demands), [costs, supplies, demands]);

  const demandLabels = useMemo(()=>Array.from({length:n},(_,j)=>`T${j+1}`),[n]);
  const supplyLabels = useMemo(()=>Array.from({length:m},(_,i)=>`S${i+1}`),[m]);

  // шаги и курсор
  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const current = steps[cursor] as Step | undefined;

  const canPrev = cursor > 0;
  const canNext = cursor < Math.max(0, steps.length - 1);

  const recompute = () => {
    const s = computeVogelSteps(costs, supplies, demands);
    setSteps(s);
    setCursor(s.length ? 0 : 0);
  };

  const resetAll = () => {
    setM(3); setN(4);
    setCosts(defaultCosts);
    setSupplies(defaultSupplies);
    setDemands(defaultDemands);
    setSteps([]); setCursor(0);
  };

  // суммирования
  const rowSum = (A: AllocCell[][], i: number) => A[i].reduce((s: number, c: AllocCell) => s + c.x, 0);
  const colSum = (A: AllocCell[][], j: number) => A.reduce((s: number, r: AllocCell[]) => s + r[j].x, 0);
  const totalCost = (A: AllocCell[][]) => {
    let z = 0; for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) z += A[i][j].x * costs[i][j]; return z;
  };

  return (
    <div className="p-2 sm:p-3 max-w-[1400px] mx-auto">
      <h1 className="text-lg sm:text-xl font-bold mb-3">Метод Фогеля — пошагово</h1>

      {/* Информация о балансировке */}
      {!isBalanced && (
        <div className="mb-3 p-3 border rounded bg-amber-50 border-amber-300">
          <div className="font-semibold text-sm mb-1 text-amber-900">⚠️ Задача несбалансирована</div>
          <div className="text-xs text-amber-800">
            Сумма запасов: <strong>{totalSupply}</strong>, Сумма потребностей: <strong>{totalDemand}</strong>
            {totalSupply > totalDemand && (
              <div className="mt-1">
                → Автоматически добавлен фиктивный потребитель <strong>T{n+1}</strong> с потребностью <strong>{totalSupply - totalDemand}</strong> и нулевыми тарифами.
              </div>
            )}
            {totalDemand > totalSupply && (
              <div className="mt-1">
                → Автоматически добавлен фиктивный поставщик <strong>S{m+1}</strong> с запасом <strong>{totalDemand - totalSupply}</strong> и нулевыми тарифами.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Панель ввода */}
      <div className="grid grid-cols-1 gap-3 mb-3">
        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2 text-sm sm:text-base">Размеры</div>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-xs mb-1">Поставщики (m)</label>
              <input type="number" min={1} value={m}
                onChange={e=>{
                  const mm=Math.max(1,+e.target.value);
                  setM(mm);
                  setCosts(prev=>Array.from({length:mm},(_,i)=>Array.from({length:n},(_,j)=>prev[i]?.[j] ?? 0)));
                  setSupplies(prev=>Array.from({length:mm},(_,i)=>prev[i] ?? 0));
                  setSteps([]); setCursor(0);
                }}
                className="border rounded px-2 py-1 w-full sm:w-20"/>
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1">Потребители (n)</label>
              <input type="number" min={1} value={n}
                onChange={e=>{
                  const nn=Math.max(1,+e.target.value);
                  setN(nn);
                  setCosts(prev=>Array.from({length:m},(_,i)=>Array.from({length:nn},(_,j)=>prev[i]?.[j] ?? 0)));
                  setDemands(prev=>Array.from({length:nn},(_,j)=>prev[j] ?? 0));
                  setSteps([]); setCursor(0);
                }}
                className="border rounded px-2 py-1 w-full sm:w-20"/>
            </div>
            <button onClick={resetAll} className="w-full sm:w-auto px-3 py-1 border rounded hover:bg-gray-50">Сброс</button>
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2 text-sm sm:text-base">Запасы Aᵢ</div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {supplies.map((v,i)=>(
              <div key={`A-${i}`} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-6 shrink-0">A{i+1}</span>
                <input type="number" value={v}
                  onChange={e=>{ const next=supplies.slice(); next[i]=+e.target.value||0; setSupplies(next); setSteps([]); }}
                  className="border rounded px-2 py-1 w-full sm:w-20"/>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2 text-sm sm:text-base">Потребности Bⱼ</div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            {demands.map((v,j)=>(
              <div key={`B-${j}`} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-6 shrink-0">B{j+1}</span>
                <input type="number" value={v}
                  onChange={e=>{ const next=demands.slice(); next[j]=+e.target.value||0; setDemands(next); setSteps([]); }}
                  className="border rounded px-2 py-1 w-full sm:w-20"/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Тарифы */}
      <div className="border rounded p-3 bg-white mb-3 overflow-x-auto">
        <div className="font-semibold mb-2 text-sm sm:text-base">Тарифы cᵢⱼ</div>
        <table className="border-collapse min-w-full text-xs sm:text-sm">
          <thead>
            <tr>
              <Th extra="bg-gray-50"></Th>
              {demandLabels.map((b,j)=><Th extra="bg-gray-50" key={`h-${j}`}>{b}</Th>)}
              {balanceInfo.addedConsumer && <Th extra="bg-amber-100" key="h-fict">T{n+1} (фикт.)</Th>}
            </tr>
          </thead>
          <tbody>
            {costs.map((row,i)=>(
              <tr key={`r-${i}`}>
                <Td extra="bg-gray-50 font-medium" key={`rs-${i}`}>{`S${i+1}`}</Td>
                {row.map((val,j)=>(
                  <td key={`c-${i}-${j}`} className="border p-1">
                    <input
                      type="number"
                      value={val}
                      onChange={e=>{
                        const next=costs.map(r=>r.slice());
                        next[i][j]=+e.target.value||0;
                        setCosts(next); setSteps([]); setCursor(0);
                      }}
                      className="border rounded px-1 sm:px-2 py-1 w-14 sm:w-20 text-center text-xs sm:text-sm"
                    />
                  </td>
                ))}
                {balanceInfo.addedConsumer && <Td extra="bg-amber-50" key={`c-${i}-fict`}>0</Td>}
              </tr>
            ))}
            {balanceInfo.addedSupplier && (
              <tr key="r-fict">
                <Td extra="bg-amber-100 font-medium" key="rs-fict">S{m+1} (фикт.)</Td>
                {Array.from({length:n},(_,j)=><Td extra="bg-amber-50" key={`c-fict-${j}`}>0</Td>)}
                {balanceInfo.addedConsumer && <Td extra="bg-amber-50" key="c-fict-fict">0</Td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Кнопки расчёта и навигации */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center mb-3">
        <button onClick={recompute} className="w-full sm:w-auto px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm sm:text-base">
          Рассчитать (Фогель)
        </button>
        <div className="flex gap-2">
          <button disabled={!canPrev} onClick={()=>setCursor(c=>Math.max(0,c-1))}
            className={`flex-1 sm:flex-none px-3 py-2 rounded border text-sm sm:text-base ${canPrev? "hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>
            ← Назад
          </button>
          <button disabled={!canNext} onClick={()=>setCursor(c=>Math.min(steps.length-1,c+1))}
            className={`flex-1 sm:flex-none px-3 py-2 rounded border text-sm sm:text-base ${canNext? "hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>
            Далее →
          </button>
        </div>
        {current && (
          <div className="w-full sm:w-auto sm:ml-2 text-xs sm:text-sm text-gray-700 p-2 sm:p-0 bg-gray-50 sm:bg-transparent rounded sm:rounded-none">
            Шаг <b>{current.stepIndex}</b> / {steps.length}: выбрано <b>S{current.i+1}→T{current.j+1}</b>, отгрузка <b>{current.placed}</b>, R=<b>{current.chosenBy==="row" ? current.rowPen[current.i] : current.colPen[current.j]}</b>, Z=<b>{current.totalCost}</b>
            {cursor === steps.length - 1 && <span className="ml-2 text-green-600 font-semibold">✓ Завершено</span>}
          </div>
        )}
      </div>

      {/* Таблица остатков по шагам (комбинированная как в коде 2) */}
      {steps.length > 0 && (
        <div className="border rounded p-2 sm:p-3 bg-white mb-3 overflow-x-auto">
          <div className="font-semibold mb-3 text-sm sm:text-base">
            {cursor === 0 && steps.length > 0 
              ? "Таблица начальных остатков и штрафов" 
              : `Таблица остатков и штрафов по шагам (до шага ${current?.stepIndex || 1})`}
          </div>
          <table className="border-collapse border-2 border-gray-800 min-w-full text-xs sm:text-sm">
            <thead>
              <tr>
                <Th extra="bg-gray-100 font-bold">Фогель</Th>
                {demandLabels.map((b, j) => <Th extra="bg-gray-100" key={`th-demand-${j}`}>{b}</Th>)}
                {balanceInfo.addedConsumer && <Th extra="bg-amber-100" key="th-demand-fict">T{n+1} (ф)</Th>}
                <Th extra="bg-gray-100 font-bold">A</Th>
                {cursor > 0 && Array.from({ length: cursor }, (_, k) => <Th extra="bg-blue-50" key={`th-roman-${k}`}>A{k + 1}</Th>)}
              </tr>
            </thead>
            <tbody>
              {/* Supply rows */}
              {supplyLabels.map((lbl, i) => (
                <tr key={`supply-row-${i}`}>
                  <Td extra="font-bold bg-gray-100">{lbl}</Td>
                  {demandLabels.map((_, j) => {
                    const placed = current?.alloc?.[i]?.[j] ?? { x: 0 };
                    const isActive = !!current && current.i === i && current.j === j;
                    return (
                      <td key={`allocation-cell-${i}-${j}`} className={`relative px-1 sm:px-2 py-1 sm:py-2 text-center border border-gray-400 ${isActive?"bg-yellow-200" : "bg-white"}`}>
                        <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c={costs[i][j]}</div>
                        <div className="font-semibold text-sm sm:text-lg">{placed.x > 0 ? placed.x : ""}</div>
                      </td>
                    );
                  })}
                  {balanceInfo.addedConsumer && (
                    <td key={`allocation-cell-${i}-fict`} className={`relative px-1 sm:px-2 py-1 sm:py-2 text-center border border-gray-400 ${!!current && current.i === i && current.j === n ? "bg-yellow-200" : "bg-amber-50"}`}>
                      <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                      <div className="font-semibold text-sm sm:text-lg">{(current?.alloc?.[i]?.[n]?.x ?? 0) > 0 ? current!.alloc[i][n].x : ""}</div>
                    </td>
                  )}
                  {/* A column - initial supplies with first step penalties */}
                  <Td extra="bg-yellow-50 font-semibold">
                    {(() => {
                      const firstStep = steps[0];
                      const pen = firstStep?.rowPen?.[i];
                      const isPenMax = isFinite(pen) && pen === Math.max(...firstStep.rowPen.filter(isFinite));
                      const isRowChosen = firstStep?.chosenBy === "row";
                      return `${supplies[i]}/${isFinite(pen) ? pen : "0"}${isRowChosen && isPenMax ? "R" : ""}`;
                    })()}
                  </Td>
                  {/* Step columns with penalties */}
                  {cursor > 0 && Array.from({ length: cursor }, (_, k) => {
                    const val = steps[k]?.suppliesLeft?.[i] ?? 0;
                    // Для столбца Ak нужны штрафы СЛЕДУЮЩЕГО шага (k+1), если он есть
                    const nextStep = steps[k + 1];
                    const pen = nextStep?.rowPen?.[i];
                    const isPenMax = nextStep && isFinite(pen) && pen === Math.max(...nextStep.rowPen.filter(isFinite));
                    const isRowChosen = nextStep?.chosenBy === "row";
                    return (
                      <Td extra={val === 0 ? "bg-gray-100 text-gray-400" : ""} key={`supply-res-${i}-${k}`}>
                        {val === 0 ? "0" : `${val}/${isFinite(pen) ? pen : "0"}${isRowChosen && isPenMax ? "R" : ""}`}
                      </Td>
                    );
                  })}
                </tr>
              ))}
              
              {/* Fictitious supplier row if added */}
              {balanceInfo.addedSupplier && (
                <tr key="supply-row-fict">
                  <Td extra="font-bold bg-amber-100">S{m+1} (ф)</Td>
                  {demandLabels.map((_, j) => {
                    const placed = current?.alloc?.[m]?.[j] ?? { x: 0 };
                    const isActive = !!current && current.i === m && current.j === j;
                    return (
                      <td key={`allocation-cell-fict-${j}`} className={`relative px-1 sm:px-2 py-1 sm:py-2 text-center border border-gray-400 ${isActive?"bg-yellow-200" : "bg-amber-50"}`}>
                        <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                        <div className="font-semibold text-sm sm:text-lg">{placed.x > 0 ? placed.x : ""}</div>
                      </td>
                    );
                  })}
                  {balanceInfo.addedConsumer && (
                    <td key="allocation-cell-fict-fict" className={`relative px-1 sm:px-2 py-1 sm:py-2 text-center border border-gray-400 ${!!current && current.i === m && current.j === n ? "bg-yellow-200" : "bg-amber-50"}`}>
                      <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                      <div className="font-semibold text-sm sm:text-lg">{(current?.alloc?.[m]?.[n]?.x ?? 0) > 0 ? current!.alloc[m][n].x : ""}</div>
                    </td>
                  )}
                  <Td extra="bg-yellow-50 font-semibold">
                    {(() => {
                      const firstStep = steps[0];
                      const pen = firstStep?.rowPen?.[m];
                      const isPenMax = isFinite(pen) && pen === Math.max(...firstStep.rowPen.filter(isFinite));
                      const isRowChosen = firstStep?.chosenBy === "row";
                      return `${balanceInfo.balancedSupplies[m]}/${isFinite(pen) ? pen : "0"}${isRowChosen && isPenMax ? "R" : ""}`;
                    })()}
                  </Td>
                  {cursor > 0 && Array.from({ length: cursor }, (_, k) => {
                    const val = steps[k]?.suppliesLeft?.[m] ?? 0;
                    const nextStep = steps[k + 1];
                    const pen = nextStep?.rowPen?.[m];
                    const isPenMax = nextStep && isFinite(pen) && pen === Math.max(...nextStep.rowPen.filter(isFinite));
                    const isRowChosen = nextStep?.chosenBy === "row";
                    return (
                      <Td extra={val === 0 ? "bg-gray-100 text-gray-400" : ""} key={`supply-res-fict-${k}`}>
                        {val === 0 ? "0" : `${val}/${isFinite(pen) ? pen : "0"}${isRowChosen && isPenMax ? "R" : ""}`}
                      </Td>
                    );
                  })}
                </tr>
              )}
              
              {/* B row - initial demands with first step penalties */}
              <tr>
                <Td extra="font-bold bg-gray-100">B</Td>
                {demands.map((d, j) => {
                  const firstStep = steps[0];
                  const pen = firstStep?.colPen?.[j];
                  const isPenMax = isFinite(pen) && pen === Math.max(...firstStep.colPen.filter(isFinite));
                  const isColChosen = firstStep?.chosenBy === "col";
                  return (
                    <Td extra="bg-yellow-50 font-semibold" key={`b-init-${j}`}>
                      {d}/{isFinite(pen) ? pen : "0"}{isColChosen && isPenMax ? "R" : ""}
                    </Td>
                  );
                })}
                {balanceInfo.addedConsumer && (
                  <Td extra="bg-amber-100 font-semibold" key="b-init-fict">
                    {(() => {
                      const firstStep = steps[0];
                      const pen = firstStep?.colPen?.[n];
                      const isPenMax = isFinite(pen) && pen === Math.max(...firstStep.colPen.filter(isFinite));
                      const isColChosen = firstStep?.chosenBy === "col";
                      return `${balanceInfo.balancedDemands[n]}/${isFinite(pen) ? pen : "0"}${isColChosen && isPenMax ? "R" : ""}`;
                    })()}
                  </Td>
                )}
                <Td extra="bg-gray-100"></Td>
                {cursor > 0 && Array.from({ length: cursor }, (_, k) => <Td extra="bg-gray-50" key={`b-spacer-${k}`}></Td>)}
              </tr>

              {/* Demand residual rows with penalties */}
              {cursor > 0 && Array.from({ length: cursor }, (_, k) => {
                // Для строки Bk нужны штрафы СЛЕДУЮЩЕГО шага (k+1), если он есть
                const nextStep = steps[k + 1];
                return (
                  <tr key={`demand-residual-row-${k}`}>
                    <Td extra="font-bold bg-blue-50">B{k + 1}</Td>
                    {demandLabels.map((_, j) => {
                      const val = steps[k]?.demandsLeft?.[j] ?? 0;
                      const pen = nextStep?.colPen?.[j];
                      const isPenMax = nextStep && isFinite(pen) && pen === Math.max(...nextStep.colPen.filter(isFinite));
                      const isColChosen = nextStep?.chosenBy === "col";
                      return (
                        <Td extra={val === 0 ? "bg-gray-100 text-gray-400" : ""} key={`demand-res-${k}-${j}`}>
                          {val === 0 ? "0" : `${val}/${isFinite(pen) ? pen : "0"}${isColChosen && isPenMax ? "R" : ""}`}
                        </Td>
                      );
                    })}
                    {balanceInfo.addedConsumer && (
                      <Td extra={steps[k]?.demandsLeft?.[n] === 0 ? "bg-gray-100 text-gray-400" : ""} key={`demand-res-${k}-fict`}>
                        {(() => {
                          const val = steps[k]?.demandsLeft?.[n] ?? 0;
                          const pen = nextStep?.colPen?.[n];
                          const isPenMax = nextStep && isFinite(pen) && pen === Math.max(...nextStep.colPen.filter(isFinite));
                          const isColChosen = nextStep?.chosenBy === "col";
                          return val === 0 ? "0" : `${val}/${isFinite(pen) ? pen : "0"}${isColChosen && isPenMax ? "R" : ""}`;
                        })()}
                      </Td>
                    )}
                    <Td extra="bg-gray-100"></Td>
                    {cursor > 0 && Array.from({ length: cursor }, (_, kk) => <Td extra="bg-gray-50" key={`spacer-${k}-${kk}`}></Td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Итоговая матрица — только на последнем шаге */}
      {current && cursor === steps.length-1 && (
        <div className="border rounded p-2 sm:p-3 bg-white mt-3 overflow-x-auto">
          <div className="font-semibold mb-2 text-sm sm:text-base">Итоговый опорный план (после последнего шага)</div>
          <table className="border-collapse min-w-full border-2 text-xs sm:text-sm">
            <thead>
              <tr>
                <Th extra="bg-gray-100"></Th>
                {demandLabels.map((b,j)=><Th extra="bg-gray-100" key={`fth-${j}`}>{b}</Th>)}
                {balanceInfo.addedConsumer && <Th extra="bg-amber-100" key="fth-fict">T{n+1} (ф)</Th>}
                <Th extra="bg-gray-100">Σ</Th>
              </tr>
            </thead>
            <tbody>
              {Array.from({length:m},(_,i)=>(
                <tr key={`frow-${i}`}>
                  <Td extra="bg-gray-50 font-semibold">{`S${i+1}`}</Td>
                  {Array.from({length:n},(_,j)=>{
                    const cell = current.alloc[i][j];
                    return (
                      <td key={`fc-${i}-${j}`} className="relative border px-1 sm:px-2 py-2 sm:py-3 text-center">
                        <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c={costs[i][j]}</div>
                        <div className="text-sm sm:text-lg font-semibold">{cell.x>0 ? cell.x : ""}</div>
                      </td>
                    );
                  })}
                  {balanceInfo.addedConsumer && (
                    <td key={`fc-${i}-fict`} className="relative border px-1 sm:px-2 py-2 sm:py-3 text-center bg-amber-50">
                      <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                      <div className="text-sm sm:text-lg font-semibold">{current.alloc[i][n]?.x > 0 ? current.alloc[i][n].x : ""}</div>
                    </td>
                  )}
                  <Td extra="bg-gray-50 font-semibold">
                    {current.alloc[i].reduce((s,c)=>s+c.x,0)}
                  </Td>
                </tr>
              ))}
              {balanceInfo.addedSupplier && (
                <tr key="frow-fict">
                  <Td extra="bg-amber-100 font-semibold">S{m+1} (ф)</Td>
                  {Array.from({length:n},(_,j)=>{
                    const cell = current.alloc[m][j];
                    return (
                      <td key={`fc-fict-${j}`} className="relative border px-1 sm:px-2 py-2 sm:py-3 text-center bg-amber-50">
                        <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                        <div className="text-sm sm:text-lg font-semibold">{cell.x>0 ? cell.x : ""}</div>
                      </td>
                    );
                  })}
                  {balanceInfo.addedConsumer && (
                    <td key="fc-fict-fict" className="relative border px-1 sm:px-2 py-2 sm:py-3 text-center bg-amber-50">
                      <div className="absolute right-0.5 sm:right-1 top-0.5 sm:top-1 text-[8px] sm:text-[10px] text-gray-500">c=0</div>
                      <div className="text-sm sm:text-lg font-semibold">{current.alloc[m][n]?.x > 0 ? current.alloc[m][n].x : ""}</div>
                    </td>
                  )}
                  <Td extra="bg-amber-100 font-semibold">
                    {current.alloc[m].reduce((s,c)=>s+c.x,0)}
                  </Td>
                </tr>
              )}
              <tr>
                <Td extra="bg-gray-50 font-semibold">Σ</Td>
                {Array.from({length:n},(_,j)=>{
                  let s=0; for(let i=0;i<m;i++) s+=current.alloc[i][j].x;
                  if (balanceInfo.addedSupplier) s+=current.alloc[m][j].x;
                  return <Td extra="bg-gray-50 font-semibold" key={`fcsum-${j}`}>{s}</Td>;
                })}
                {balanceInfo.addedConsumer && (
                  <Td extra="bg-amber-100 font-semibold" key="fcsum-fict">
                    {(() => {
                      let s=0; 
                      for(let i=0;i<m;i++) s+=current.alloc[i][n]?.x ?? 0;
                      if (balanceInfo.addedSupplier) s+=current.alloc[m][n]?.x ?? 0;
                      return s;
                    })()}
                  </Td>
                )}
                <Td extra="bg-green-100 font-bold">Z = {totalCost(current.alloc)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Легенда */}
      <div className="text-[10px] sm:text-xs text-gray-500 mt-3 px-1 sm:px-0">
        <div className="flex flex-wrap gap-2 sm:gap-4 mb-2">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-yellow-200 border border-gray-300 shrink-0"></span>
            <span className="text-[10px] sm:text-xs">Текущая ячейка</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-yellow-50 border border-gray-300 shrink-0"></span>
            <span className="text-[10px] sm:text-xs">Начальные запасы/потребности</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-blue-50 border border-gray-300 shrink-0"></span>
            <span className="text-[10px] sm:text-xs">Римские цифры - номера итераций</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-amber-50 border border-amber-300 shrink-0"></span>
            <span className="text-[10px] sm:text-xs">Фиктивные элементы (c=0)</span>
          </span>
        </div>
        <div className="text-[10px] sm:text-xs leading-relaxed">
          <div className="mb-2">
            Формат ячеек: <strong>остаток/штраф</strong>. Максимальный штраф отмечен буквой <strong>R</strong>.
          </div>
          <div className="mb-2">
            <strong>Алгоритм метода Фогеля:</strong>
          </div>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Для каждой строки и столбца вычисляется <strong>штраф</strong> — разница между двумя минимальными тарифами.</li>
            <li>Выбирается <strong>максимальный штраф</strong>. Если несколько штрафов одинаковы, выбирается тот, где минимальная стоимость перевозки наименьшая.</li>
            <li>В выбранной строке/столбце заполняется ячейка с <strong>минимальным тарифом</strong>.</li>
            <li>Процесс повторяется до полного распределения всех запасов и потребностей.</li>
          </ol>
          {!isBalanced && (
            <div className="mt-2 text-amber-700 font-medium">
              ℹ️ Задача несбалансирована — автоматически добавлены фиктивные элементы с нулевыми тарифами для балансировки.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}