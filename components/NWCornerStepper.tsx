import React, { useMemo, useState } from "react";

/* =================== маленькие компоненты ячеек =================== */
const Th = ({ extra = "", children = null }: { extra?: string; children?: any }) => (
  <th className={`px-2 py-2 text-center border ${extra}`}>{children}</th>
);
const Td = ({ extra = "", children = null }: { extra?: string; children?: any }) => (
  <td className={`px-2 py-2 text-center border ${extra}`}>{children}</td>
);

/* ======================= Helpers для римских цифр ======================= */
const toRoman = (num) => {
  if (num <= 0) return "";
  const romans = [
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
function twoSmallest(values) {
  if (values.length === 0) return [Infinity, Infinity];
  if (values.length === 1) return [values[0], values[0]];
  
  // Сортируем копию массива и берем первые два элемента
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[0], sorted[1]];
}

function cloneAlloc(A) {
  return A.map(r => r.map(c => ({ ...c })));
}

/** Считает ВСЕ шаги Фогеля (до закрытия задачи) — для пошагового просмотра */
function computeVogelSteps(costs, s0, d0) {
  const m = s0.length, n = d0.length;
  const supplies = s0.slice();
  const demands  = d0.slice();
  const alloc = Array.from({ length: m }, () =>
    Array.from({ length: n }, () => ({ x: 0 }))
  );

  const steps = [];
  let Z = 0, step = 0;

  while (supplies.some(v=>v>0) && demands.some(v=>v>0) && step < 10_000) {
    // штрафы по строкам
    const rowPen = Array(m).fill(-Infinity);
    for (let i=0;i<m;i++) {
      if (supplies[i] === 0) continue;
      const rowCosts = [];
      for (let j=0;j<n;j++) if (demands[j] > 0) rowCosts.push(costs[i][j]);
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
      for (let i=0;i<m;i++) if (supplies[i] > 0) colCosts.push(costs[i][j]);
      if (colCosts.length === 0) continue;
      const [a,b] = twoSmallest(colCosts);
      // штраф = разница между вторым и первым минимальными значениями
      colPen[j] = colCosts.length === 1 ? a : (b - a);
    }

    // выбираем максимальный штраф
    let chosenBy = "row";
    let bestIdx = -1, bestPen = -Infinity;
    for (let i=0;i<m;i++) if (isFinite(rowPen[i]) && rowPen[i] > bestPen) { bestPen=rowPen[i]; chosenBy="row"; bestIdx=i; }
    for (let j=0;j<n;j++) if (isFinite(colPen[j]) && colPen[j] > bestPen) { bestPen=colPen[j]; chosenBy="col"; bestIdx=j; }
    if (bestIdx < 0) break;

    // внутри выбранной строки/столбца берем ячейку с МИНИМАЛЬНОЙ стоимостью
    let selI = 0, selJ = 0;
    if (chosenBy === "row") {
      selI = bestIdx;
      let min = Infinity, arg = -1;
      for (let j=0;j<n;j++) if (demands[j] > 0 && costs[selI][j] < min) { min = costs[selI][j]; arg = j; }
      selJ = arg;
    } else {
      selJ = bestIdx;
      let min = Infinity, arg = -1;
      for (let i=0;i<m;i++) if (supplies[i] > 0 && costs[i][selJ] < min) { min = costs[i][selJ]; arg = i; }
      selI = arg;
    }

    const taken = Math.min(supplies[selI], demands[selJ]);
    alloc[selI][selJ].x += taken;
    alloc[selI][selJ].penaltyUsed = bestPen;
    supplies[selI] -= taken;
    demands[selJ]  -= taken;
    Z += taken * costs[selI][selJ];

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
  [2, 3, 8, 7],
  [ 2, 0, 7, 3],
  [ 5, 7, 5, 8],
];
const defaultSupplies = [70, 10, 80];
const defaultDemands  = [60, 40, 40, 20];

/* ============================== компонент ============================== */
export default function VogelStepper() {
  const [m, setM] = useState(3);
  const [n, setN] = useState(4);
  const [costs, setCosts] = useState(defaultCosts);
  const [supplies, setSupplies] = useState(defaultSupplies);
  const [demands, setDemands] = useState(defaultDemands);

  const demandLabels = useMemo(()=>Array.from({length:n},(_,j)=>`T${j+1}`),[n]);
  const supplyLabels = useMemo(()=>Array.from({length:m},(_,i)=>`S${i+1}`),[m]);

  // шаги и курсор
  const [steps, setSteps] = useState([]);
  const [cursor, setCursor] = useState(0);
  const current = steps[cursor];

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
  const rowSum = (A, i) => A[i].reduce((s,c)=>s+c.x,0);
  const colSum = (A, j) => A.reduce((s,r)=>s+r[j].x,0);
  const totalCost = (A) => {
    let z=0; for(let i=0;i<m;i++)for(let j=0;j<n;j++) z+=A[i][j].x*costs[i][j]; return z;
  };

  return (
    <div className="p-3 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-bold mb-3">Метод Фогеля — пошагово</h1>

      {/* Панель ввода */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Размеры</div>
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs mb-1">Поставщики (m)</label>
              <input type="number" min={1} value={m}
                onChange={e=>{
                  const mm=Math.max(1,+e.target.value);
                  setM(mm);
                  setCosts(prev=>Array.from({length:mm},(_,i)=>Array.from({length:n},(_,j)=>prev[i]?.[j] ?? 0)));
                  setSupplies(prev=>Array.from({length:mm},(_,i)=>prev[i] ?? 0));
                  setSteps([]); setCursor(0);
                }}
                className="border rounded px-2 py-1 w-20"/>
            </div>
            <div>
              <label className="block text-xs mb-1">Потребители (n)</label>
              <input type="number" min={1} value={n}
                onChange={e=>{
                  const nn=Math.max(1,+e.target.value);
                  setN(nn);
                  setCosts(prev=>Array.from({length:m},(_,i)=>Array.from({length:nn},(_,j)=>prev[i]?.[j] ?? 0)));
                  setDemands(prev=>Array.from({length:nn},(_,j)=>prev[j] ?? 0));
                  setSteps([]); setCursor(0);
                }}
                className="border rounded px-2 py-1 w-20"/>
            </div>
            <button onClick={resetAll} className="ml-auto px-3 py-1 border rounded hover:bg-gray-50">Сброс</button>
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Запасы Aᵢ</div>
          <div className="flex flex-wrap gap-2">
            {supplies.map((v,i)=>(
              <div key={`A-${i}`} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-6">A{i+1}</span>
                <input type="number" value={v}
                  onChange={e=>{ const next=supplies.slice(); next[i]=+e.target.value||0; setSupplies(next); setSteps([]); }}
                  className="border rounded px-2 py-1 w-20"/>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Потребности Bⱼ</div>
          <div className="flex flex-wrap gap-2">
            {demands.map((v,j)=>(
              <div key={`B-${j}`} className="flex items-center gap-1">
                <span className="text-xs text-gray-600 w-6">B{j+1}</span>
                <input type="number" value={v}
                  onChange={e=>{ const next=demands.slice(); next[j]=+e.target.value||0; setDemands(next); setSteps([]); }}
                  className="border rounded px-2 py-1 w-20"/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Тарифы */}
      <div className="border rounded p-3 bg-white mb-3 overflow-x-auto">
        <div className="font-semibold mb-2">Тарифы cᵢⱼ</div>
        <table className="border-collapse min-w-full">
          <thead>
            <tr>
              <Th extra="bg-gray-50"></Th>
              {demandLabels.map((b,j)=><Th extra="bg-gray-50" key={`h-${j}`}>{b}</Th>)}
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
                      className="border rounded px-2 py-1 w-20 text-center"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Кнопки расчёта и навигации */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <button onClick={recompute} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
          Рассчитать (Фогель)
        </button>
        <button disabled={!canPrev} onClick={()=>setCursor(c=>Math.max(0,c-1))}
          className={`px-3 py-2 rounded border ${canPrev? "hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>
          ← Назад
        </button>
        <button disabled={!canNext} onClick={()=>setCursor(c=>Math.min(steps.length-1,c+1))}
          className={`px-3 py-2 rounded border ${canNext? "hover:bg-gray-50":"opacity-50 cursor-not-allowed"}`}>
          Далее →
        </button>
        {current && (
          <div className="ml-2 text-sm text-gray-700">
            Шаг <b>{current.stepIndex}</b> / {steps.length}: выбрано <b>S{current.i+1}→T{current.j+1}</b>, отгрузка <b>{current.placed}</b>, R=<b>{current.chosenBy==="row" ? current.rowPen[current.i] : current.colPen[current.j]}</b>, Z=<b>{current.totalCost}</b>
            {cursor === steps.length - 1 && <span className="ml-2 text-green-600 font-semibold">✓ Завершено</span>}
          </div>
        )}
      </div>

      {/* Таблица остатков по шагам (комбинированная как в коде 2) */}
      {steps.length > 0 && (
        <div className="border rounded p-3 bg-white mb-3 overflow-x-auto">
          <div className="font-semibold mb-3">
            {cursor === 0 && steps.length > 0 
              ? "Таблица начальных остатков и штрафов" 
              : `Таблица остатков и штрафов по шагам (до шага ${current?.stepIndex || 1})`}
          </div>
          <table className="border-collapse border-2 border-gray-800 min-w-full">
            <thead>
              <tr>
                <Th extra="bg-gray-100 font-bold">Фогель</Th>
                {demandLabels.map((b, j) => <Th extra="bg-gray-100" key={`th-demand-${j}`}>{b}</Th>)}
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
                    const placed = current.alloc[i][j];
                    const isActive = current && current.i === i && current.j === j;
                    return (
                      <td key={`allocation-cell-${i}-${j}`} className={`relative px-2 py-2 text-center border border-gray-400 ${isActive?"bg-yellow-200" : "bg-white"}`}>
                        <div className="absolute right-1 top-1 text-[10px] text-gray-500">c={costs[i][j]}</div>
                        <div className="font-semibold text-lg">{placed.x > 0 ? placed.x : ""}</div>
                      </td>
                    );
                  })}
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
        <div className="border rounded p-3 bg-white mt-3 overflow-x-auto">
          <div className="font-semibold mb-2">Итоговый опорный план (после последнего шага)</div>
          <table className="border-collapse min-w-full border-2">
            <thead>
              <tr>
                <Th extra="bg-gray-100"></Th>
                {demandLabels.map((b,j)=><Th extra="bg-gray-100" key={`fth-${j}`}>{b}</Th>)}
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
                      <td key={`fc-${i}-${j}`} className="relative border px-2 py-3 text-center">
                        <div className="absolute right-1 top-1 text-[10px] text-gray-500">c={costs[i][j]}</div>
                        <div className="text-lg font-semibold">{cell.x>0 ? cell.x : ""}</div>
                      </td>
                    );
                  })}
                  <Td extra="bg-gray-50 font-semibold">
                    {current.alloc[i].reduce((s,c)=>s+c.x,0)}
                  </Td>
                </tr>
              ))}
              <tr>
                <Td extra="bg-gray-50 font-semibold">Σ</Td>
                {Array.from({length:n},(_,j)=>{
                  let s=0; for(let i=0;i<m;i++) s+=current.alloc[i][j].x;
                  return <Td extra="bg-gray-50 font-semibold" key={`fcsum-${j}`}>{s}</Td>;
                })}
                <Td extra="bg-green-100 font-bold">Z = {totalCost(current.alloc)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Легенда */}
      <div className="text-xs text-gray-500 mt-3">
        <div className="flex flex-wrap gap-4 mb-2">
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 bg-yellow-200 border border-gray-300"></span>
            Текущая ячейка
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 bg-yellow-50 border border-gray-300"></span>
            Начальные запасы/потребности
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 bg-blue-50 border border-gray-300"></span>
            Римские цифры - номера итераций
          </span>
        </div>
        <div>
          Формат ячеек: <strong>остаток/штраф</strong>. Максимальный штраф отмечен буквой <strong>R</strong>.
          Штраф — разница между двумя минимальными тарифами в строке (для A) или столбце (для B).
          Выбирается максимальный штраф, затем в соответствующей строке/столбце — минимальный тариф.
        </div>
      </div>
    </div>
  );
}