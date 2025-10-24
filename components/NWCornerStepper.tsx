import React, { useState, useMemo } from "react";

/* =================== маленькие компоненты ячеек =================== */
const Th = ({ extra = "", children = null }: { extra?: string; children?: React.ReactNode }) => (
  <th className={`px-1 sm:px-2 py-1 sm:py-2 text-center border text-xs sm:text-sm ${extra}`}>{children}</th>
);

const Td = ({ extra = "", children = null }: { extra?: string; children?: React.ReactNode }) => (
  <td className={`px-1 sm:px-2 py-1 sm:py-2 text-center border text-xs sm:text-sm ${extra}`}>{children}</td>
);

/* ======================= Типы для венгерского алгоритма ======================= */
type CellMark = 'independent' | 'dependent' | null; // * или ' или null
type Matrix = number[][];
type MarkMatrix = CellMark[][];

interface Step {
  stepIndex: number;
  iterationNumber?: number; // номер итерации (1, 2, 3...)
  subStepNumber?: number; // номер подшага внутри A1 (1, 2, 3...)
  phase: 'reduction_col' | 'reduction_row' | 'A0' | 'A1' | 'A2' | 'A3';
  matrix: Matrix;
  marks: MarkMatrix;
  markedCols: boolean[];
  markedRows: boolean[];
  transferredCols: number[]; // столбцы, откуда перенесли +
  transferredColsNumbers?: number[]; // номера подшагов для переносов
  dependentZeroNumbers?: Map<string, number>; // карта "i,j" -> номер подшага для зависимых нулей
  description: string;
  reductionValues?: number[]; // для фазы редукции
  cyclePositions?: [number, number][]; // для фазы А2
  minValueA3?: number; // для фазы А3
  selectedCell?: [number, number]; // выбранная ячейка на шаге
}

/* ======================= Алгоритм ======================= */

// Редукция по столбцам
function reduceColumns(matrix: Matrix): { reduced: Matrix; values: number[] } {
  const n = matrix.length;
  const reduced = matrix.map(row => [...row]);
  const values: number[] = [];
  
  for (let j = 0; j < n; j++) {
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      if (reduced[i][j] < min) min = reduced[i][j];
    }
    values.push(min);
    for (let i = 0; i < n; i++) {
      reduced[i][j] -= min;
    }
  }
  
  return { reduced, values };
}

// Редукция по строкам
function reduceRows(matrix: Matrix): { reduced: Matrix; values: number[] } {
  const n = matrix.length;
  const reduced = matrix.map(row => [...row]);
  const values: number[] = [];
  
  for (let i = 0; i < n; i++) {
    let min = Infinity;
    for (let j = 0; j < n; j++) {
      if (reduced[i][j] < min) min = reduced[i][j];
    }
    values.push(min);
    for (let j = 0; j < n; j++) {
      reduced[i][j] -= min;
    }
  }
  
  return { reduced, values };
}

// Создать пустую матрицу меток
function createEmptyMarks(n: number): MarkMatrix {
  return Array.from({ length: n }, () => Array(n).fill(null));
}

// Шаг A0: пометить столбцы с независимыми 0
function phaseA0(matrix: Matrix, marks: MarkMatrix): boolean[] {
  const n = matrix.length;
  const markedCols = Array(n).fill(false);
  
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (marks[i][j] === 'independent') {
        markedCols[j] = true;
        break;
      }
    }
  }
  
  return markedCols;
}

// Найти первый незачеркнутый 0 в самом левом незачеркнутом столбце
function findFirstUncrossedZero(
  matrix: Matrix,
  marks: MarkMatrix,
  markedCols: boolean[],
  markedRows: boolean[]
): [number, number] | null {
  const n = matrix.length;
  
  // Ищем в самом левом незачеркнутом столбце, затем по строкам
  for (let j = 0; j < n; j++) {
    if (markedCols[j]) continue;
    for (let i = 0; i < n; i++) {
      if (markedRows[i]) continue;
      if (matrix[i][j] === 0 && marks[i][j] === null) {
        return [i, j];
      }
    }
  }
  
  return null;
}

// Найти независимый 0 в строке
function findIndependentInRow(marks: MarkMatrix, row: number): number | null {
  for (let j = 0; j < marks[row].length; j++) {
    if (marks[row][j] === 'independent') return j;
  }
  return null;
}

// Найти цикл для фазы А2
function findCycle(
  matrix: Matrix,
  marks: MarkMatrix,
  startRow: number,
  startCol: number
): [number, number][] {
  const cycle: [number, number][] = [[startRow, startCol]];
  let currentRow = startRow;
  let currentCol = startCol;
  let lookingForIndependent = true;
  
  const n = matrix.length;
  const maxIterations = n * n * 2;
  let iterations = 0;
  
  while (iterations++ < maxIterations) {
    if (lookingForIndependent) {
      // Ищем независимый 0 по вертикали
      let found = false;
      for (let i = 0; i < n; i++) {
        if (i === currentRow) continue;
        if (marks[i][currentCol] === 'independent') {
          currentRow = i;
          cycle.push([i, currentCol]);
          lookingForIndependent = false;
          found = true;
          break;
        }
      }
      if (!found) break;
    } else {
      // Ищем зависимый 0 по горизонтали
      let found = false;
      for (let j = 0; j < n; j++) {
        if (j === currentCol) continue;
        if (marks[currentRow][j] === 'dependent') {
          currentCol = j;
          cycle.push([currentRow, j]);
          lookingForIndependent = true;
          found = true;
          
          // Проверяем, вернулись ли к началу
          if (currentRow === startRow && currentCol === startCol) {
            return cycle;
          }
          break;
        }
      }
      if (!found) break;
    }
  }
  
  return cycle;
}

// Вычислить все шаги венгерского алгоритма
function computeHungarianSteps(initialMatrix: Matrix): Step[] {
  const steps: Step[] = [];
  const n = initialMatrix.length;
  let stepIndex = 0;
  
  // Редукция по столбцам
  const { reduced: afterColReduction, values: colValues } = reduceColumns(initialMatrix);
  steps.push({
    stepIndex: ++stepIndex,
    phase: 'reduction_col',
    matrix: afterColReduction,
    marks: createEmptyMarks(n),
    markedCols: Array(n).fill(false),
    markedRows: Array(n).fill(false),
    transferredCols: [],
    description: 'Редукция по столбцам: вычитаем минимум из каждого столбца',
    reductionValues: colValues,
  });
  
  // Редукция по строкам
  const { reduced: afterRowReduction, values: rowValues } = reduceRows(afterColReduction);
  steps.push({
    stepIndex: ++stepIndex,
    phase: 'reduction_row',
    matrix: afterRowReduction,
    marks: createEmptyMarks(n),
    markedCols: Array(n).fill(false),
    markedRows: Array(n).fill(false),
    transferredCols: [],
    description: 'Редукция по строкам: вычитаем минимум из каждой строки',
    reductionValues: rowValues,
  });
  
  let currentMatrix = afterRowReduction.map(row => [...row]);
  let currentMarks = createEmptyMarks(n);
  
  // Находим начальные независимые нули (один на строку и столбец)
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (currentMatrix[i][j] === 0 && !usedRows.has(i) && !usedCols.has(j)) {
        currentMarks[i][j] = 'independent';
        usedRows.add(i);
        usedCols.add(j);
        break;
      }
    }
  }
  
  let continueIterations = true;
  let iterationCount = 0;
  const maxIterations = 100;
  
  while (continueIterations && iterationCount++ < maxIterations) {
    // Фаза A0
    const markedCols = phaseA0(currentMatrix, currentMarks);
    steps.push({
      stepIndex: ++stepIndex,
      iterationNumber: iterationCount,
      phase: 'A0',
      matrix: currentMatrix.map(row => [...row]),
      marks: currentMarks.map(row => [...row]),
      markedCols: [...markedCols],
      markedRows: Array(n).fill(false),
      transferredCols: [],
      description: `Итерация ${iterationCount} - A0: Помечаем столбцы (+) с независимыми нулями (0*)`,
    });
    
    // Фаза A1
    let markedRows = Array(n).fill(false);
    let transferredCols: number[] = [];
    let transferredColsNumbers: number[] = [];
    let dependentZeroNumbers = new Map<string, number>(); // карта для отслеживания номеров зависимых нулей
    let phaseA1Active = true;
    let foundDependentWithoutIndependent = false;
    let lastDependentCell: [number, number] | null = null;
    let a1SubStep = 0; // счётчик подшагов внутри A1
    
    while (phaseA1Active) {
      const zeroPos = findFirstUncrossedZero(currentMatrix, currentMarks, markedCols, markedRows);
      
      if (zeroPos === null) {
        // Все независимые 0 в зачеркнутых линиях -> A3
        steps.push({
          stepIndex: ++stepIndex,
          iterationNumber: iterationCount,
          phase: 'A1',
          matrix: currentMatrix.map(row => [...row]),
          marks: currentMarks.map(row => [...row]),
          markedCols: [...markedCols],
          markedRows: [...markedRows],
          transferredCols: [...transferredCols],
          description: `Итерация ${iterationCount} - A1: Все нули просмотрены, все независимые нули в зачеркнутых линиях → переход к A3`,
        });
        
        // Фаза A3
        let minVal = Infinity;
        for (let i = 0; i < n; i++) {
          if (markedRows[i]) continue;
          for (let j = 0; j < n; j++) {
            if (markedCols[j]) continue;
            if (currentMatrix[i][j] < minVal) {
              minVal = currentMatrix[i][j];
            }
          }
        }
        
        // Вычитаем минимум из незачеркнутых клеток
        // Прибавляем минимум к клеткам на пересечении зачеркнутых строк и столбцов
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const rowMarked = markedRows[i];
            const colMarked = markedCols[j];
            
            if (rowMarked && colMarked) {
              // Пересечение зачеркнутых линий - прибавляем
              currentMatrix[i][j] += minVal;
            } else if (!rowMarked && !colMarked) {
              // Незачеркнутая клетка - вычитаем
              currentMatrix[i][j] -= minVal;
            }
            // Если только одна линия зачеркнута - не меняем
          }
        }
        
        steps.push({
          stepIndex: ++stepIndex,
          iterationNumber: iterationCount,
          phase: 'A3',
          matrix: currentMatrix.map(row => [...row]),
          marks: currentMarks.map(row => [...row]),
          markedCols: [...markedCols],
          markedRows: [...markedRows],
          transferredCols: [],
          description: `Итерация ${iterationCount} - A3: Вычитаем минимум (${minVal}) из незачеркнутых клеток, прибавляем к пересечениям зачеркнутых линий → возврат к A1`,
          minValueA3: minVal,
        });
        
        // После A3 сбрасываем счётчик подшагов A1, карту зависимых нулей и перенесенные +
        a1SubStep = 0;
        dependentZeroNumbers.clear();
        transferredCols = [];
        transferredColsNumbers = [];
        
        // После A3 продолжаем A1 с теми же метками (не выходим из цикла, не сбрасываем метки)
        // phaseA1Active остается true, markedCols и markedRows сохраняются
        continue;
      }
      
      const [zeroRow, zeroCol] = zeroPos;
      
      // Увеличиваем счётчик подшагов A1
      a1SubStep++;
      
      // Сначала сохраняем шаг с выбранной клеткой, но ещё без метки
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        subStepNumber: a1SubStep,
        phase: 'A1',
        matrix: currentMatrix.map(row => [...row]),
        marks: currentMarks.map(row => [...row]),
        markedCols: [...markedCols],
        markedRows: [...markedRows],
        transferredCols: [...transferredCols],
        transferredColsNumbers: [...transferredColsNumbers],
        dependentZeroNumbers: new Map(dependentZeroNumbers),
        description: `Итерация ${iterationCount} - A1.${a1SubStep}: Выбран незачеркнутый ноль в [${zeroRow + 1}, ${zeroCol + 1}]`,
        selectedCell: [zeroRow, zeroCol],
      });
      
      currentMarks[zeroRow][zeroCol] = 'dependent';
      dependentZeroNumbers.set(`${zeroRow},${zeroCol}`, a1SubStep);
      
      const independentCol = findIndependentInRow(currentMarks, zeroRow);
      
      if (independentCol === null) {
        // Нет независимого 0 в строке -> A2
        foundDependentWithoutIndependent = true;
        lastDependentCell = [zeroRow, zeroCol];
        
        steps.push({
          stepIndex: ++stepIndex,
          iterationNumber: iterationCount,
          subStepNumber: a1SubStep,
          phase: 'A1',
          matrix: currentMatrix.map(row => [...row]),
          marks: currentMarks.map(row => [...row]),
          markedCols: [...markedCols],
          markedRows: [...markedRows],
          transferredCols: [...transferredCols],
          transferredColsNumbers: [...transferredColsNumbers],
          dependentZeroNumbers: new Map(dependentZeroNumbers),
          description: `Итерация ${iterationCount} - A1.${a1SubStep}: Помечен зависимый ноль (0'${a1SubStep}) в [${zeroRow + 1}, ${zeroCol + 1}], независимого нуля в строке нет → переход к A2`,
          selectedCell: [zeroRow, zeroCol],
        });
        
        phaseA1Active = false;
        break;
      }
      
      // Переносим + со столбца на строку
      markedCols[independentCol] = false;
      markedRows[zeroRow] = true;
      transferredCols.push(independentCol);
      transferredColsNumbers.push(a1SubStep);
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        subStepNumber: a1SubStep,
        phase: 'A1',
        matrix: currentMatrix.map(row => [...row]),
        marks: currentMarks.map(row => [...row]),
        markedCols: [...markedCols],
        markedRows: [...markedRows],
        transferredCols: [...transferredCols],
        transferredColsNumbers: [...transferredColsNumbers],
        dependentZeroNumbers: new Map(dependentZeroNumbers),
        description: `Итерация ${iterationCount} - A1.${a1SubStep}: Помечен зависимый ноль (0'${a1SubStep}) в [${zeroRow + 1}, ${zeroCol + 1}], переносим + со столбца ${independentCol + 1} на строку ${zeroRow + 1}`,
        selectedCell: [zeroRow, zeroCol],
      });
    }
    
    // Фаза A2 (если нужна)
    if (foundDependentWithoutIndependent && lastDependentCell) {
      const cycle = findCycle(currentMatrix, currentMarks, lastDependentCell[0], lastDependentCell[1]);
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'A2',
        matrix: currentMatrix.map(row => [...row]),
        marks: currentMarks.map(row => [...row]),
        markedCols: [...markedCols],
        markedRows: [...markedRows],
        transferredCols: [],
        description: `Итерация ${iterationCount} - A2: Найден цикл, меняем зависимые (0') на независимые (0*) и наоборот`,
        cyclePositions: cycle,
      });
      
      // Меняем метки в цикле
      for (const [i, j] of cycle) {
        if (currentMarks[i][j] === 'dependent') {
          currentMarks[i][j] = 'independent';
        } else if (currentMarks[i][j] === 'independent') {
          currentMarks[i][j] = 'dependent';
        }
      }
      
      // Убираем все зависимые нули, которые не в цикле
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (currentMarks[i][j] === 'dependent') {
            const inCycle = cycle.some(([ci, cj]) => ci === i && cj === j);
            if (!inCycle) {
              currentMarks[i][j] = null;
            }
          }
        }
      }
      
      // Убираем оставшиеся зависимые нули после цикла
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (currentMarks[i][j] === 'dependent') {
            currentMarks[i][j] = null;
          }
        }
      }
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'A2',
        matrix: currentMatrix.map(row => [...row]),
        marks: currentMarks.map(row => [...row]),
        markedCols: Array(n).fill(false),
        markedRows: Array(n).fill(false),
        transferredCols: [],
        description: `Итерация ${iterationCount} - A2: Метки изменены, возврат к A0`,
        cyclePositions: cycle,
      });
    }
    
    // Проверяем, достигли ли мы решения
    const independentCount = currentMarks.flat().filter(m => m === 'independent').length;
    if (independentCount === n) {
      continueIterations = false;
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'A0',
        matrix: currentMatrix.map(row => [...row]),
        marks: currentMarks.map(row => [...row]),
        markedCols: Array(n).fill(false),
        markedRows: Array(n).fill(false),
        transferredCols: [],
        description: `Решение найдено! Все ${n} назначений выполнены (${n} независимых нулей).`,
      });
    }
  }
  
  return steps;
}

/* ============================== дефолтные данные ============================== */
const defaultMatrix = [
  [4, 3, 8, 2, 8],
  [9, 3, 1, 3, 4],
  [1, 7, 1, 4, 7],
  [2, 3, 8, 9, 6],
  [6, 4, 3, 6, 6],
];

/* ============================== компонент ============================== */
export default function HungarianAlgorithm() {
  const [n, setN] = useState(5);
  const [matrix, setMatrix] = useState<Matrix>(defaultMatrix);
  
  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const current = steps[cursor] as Step | undefined;
  
  const canPrev = cursor > 0;
  const canNext = cursor < steps.length - 1;
  
  const recompute = () => {
    const s = computeHungarianSteps(matrix);
    setSteps(s);
    setCursor(0);
  };
  
  const resetAll = () => {
    setN(5);
    setMatrix(defaultMatrix);
    setSteps([]);
    setCursor(0);
  };
  
  const calculateTotalCost = () => {
    if (!current) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (current.marks[i][j] === 'independent') {
          total += matrix[i][j];
        }
      }
    }
    return total;
  };
  
  return (
    <div className="p-2 sm:p-3 md:p-4 max-w-[1400px] mx-auto">
      <h1 className="text-base sm:text-lg md:text-xl font-bold mb-2 sm:mb-3">Венгерский алгоритм — пошагово</h1>
      
      {/* Панель ввода */}
      <div className="grid grid-cols-1 gap-2 sm:gap-3 mb-2 sm:mb-3">
        <div className="border rounded p-2 sm:p-3 bg-white">
          <div className="font-semibold mb-2 text-xs sm:text-sm md:text-base">Размер матрицы</div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-[10px] sm:text-xs mb-1">Размерность (n×n)</label>
              <input 
                type="number" 
                min={2} 
                max={10}
                value={n}
                onChange={e => {
                  const newN = Math.max(2, Math.min(10, +e.target.value));
                  setN(newN);
                  setMatrix(prev => 
                    Array.from({ length: newN }, (_, i) =>
                      Array.from({ length: newN }, (_, j) => prev[i]?.[j] ?? 0)
                    )
                  );
                  setSteps([]);
                  setCursor(0);
                }}
                className="border rounded px-2 py-1 w-full sm:w-20 text-sm"
              />
            </div>
            <button onClick={resetAll} className="w-full sm:w-auto px-3 py-1.5 sm:py-1 border rounded hover:bg-gray-50 text-xs sm:text-sm">
              Сброс
            </button>
          </div>
        </div>
      </div>
      
      {/* Матрица стоимостей */}
      <div className="border rounded p-2 sm:p-3 bg-white mb-2 sm:mb-3 overflow-x-auto">
        <div className="font-semibold mb-2 text-xs sm:text-sm md:text-base">Матрица стоимостей</div>
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="border-collapse min-w-full text-[10px] sm:text-xs md:text-sm mx-auto">
            <tbody>
              {matrix.map((row, i) => (
                <tr key={`r-${i}`}>
                  {row.map((val, j) => (
                    <td key={`c-${i}-${j}`} className="border p-0.5 sm:p-1">
                      <input
                        type="number"
                        value={val}
                        onChange={e => {
                          const next = matrix.map(r => r.slice());
                          next[i][j] = +e.target.value || 0;
                          setMatrix(next);
                          setSteps([]);
                          setCursor(0);
                        }}
                        className="border rounded px-1 sm:px-2 py-0.5 sm:py-1 w-10 sm:w-14 md:w-16 text-center text-[10px] sm:text-xs md:text-sm"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Кнопки расчёта и навигации */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center mb-2 sm:mb-3">
        <button 
          onClick={recompute} 
          className="w-full sm:w-auto px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs sm:text-sm md:text-base font-medium"
        >
          Рассчитать
        </button>
        <div className="flex gap-2">
          <button 
            disabled={!canPrev} 
            onClick={() => setCursor(c => Math.max(0, c - 1))}
            className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 sm:py-2 rounded border text-xs sm:text-sm md:text-base ${
              canPrev ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
            }`}
          >
            ← Назад
          </button>
          <button 
            disabled={!canNext} 
            onClick={() => setCursor(c => Math.min(steps.length - 1, c + 1))}
            className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 sm:py-2 rounded border text-xs sm:text-sm md:text-base ${
              canNext ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
            }`}
          >
            Далее →
          </button>
        </div>
        {current && (
          <div className="w-full sm:w-auto sm:ml-2 text-[10px] sm:text-xs md:text-sm text-gray-700 p-2 sm:p-1.5 md:p-0 bg-gray-50 sm:bg-transparent rounded sm:rounded-none">
            <b>Шаг {current.stepIndex}</b> / {steps.length}
            {current.iterationNumber && <span className="ml-1 sm:ml-2 text-purple-600">| Итерация {current.iterationNumber}</span>}
            <span className="ml-1 sm:ml-2">| {current.phase}</span>
            {cursor === steps.length - 1 && <span className="ml-1 sm:ml-2 text-green-600 font-semibold">✓ Завершено</span>}
          </div>
        )}
      </div>
      
      {/* Описание текущего шага */}
      {current && (
        <>
          {/* Заголовок итерации */}
          {current.iterationNumber && (
            <div className="border-2 border-purple-400 rounded p-1.5 sm:p-2 bg-purple-50 mb-2 sm:mb-3">
              <div className="font-bold text-sm sm:text-base md:text-lg text-purple-700">
                ИТЕРАЦИЯ {current.iterationNumber}
              </div>
            </div>
          )}
          
          <div className="border rounded p-2 sm:p-3 bg-blue-50 mb-2 sm:mb-3">
            <div className="font-semibold text-xs sm:text-sm mb-1">Описание шага:</div>
            <div className="text-[10px] sm:text-xs md:text-sm">{current.description}</div>
            {current.reductionValues && (
              <div className="text-[10px] sm:text-xs mt-1 sm:mt-2">
                Вычтенные значения: [{current.reductionValues.join(', ')}]
              </div>
            )}
          </div>
        </>
      )}
      
      {/* Текущая матрица */}
      {current && (
        <div className="border rounded p-2 sm:p-3 bg-white mb-2 sm:mb-3">
          <div className="font-semibold mb-2 text-xs sm:text-sm md:text-base">
            Матрица на шаге {current.stepIndex}
          </div>
          <div className="overflow-x-auto -mx-2 sm:mx-0">
            <table className="border-collapse border-2 border-gray-800 min-w-full text-[10px] sm:text-xs md:text-sm mx-auto">
              <thead>
                <tr>
                  <Th extra="bg-gray-100"></Th>
                  {Array.from({ length: n }, (_, j) => {
                    const transferredIndex = current.transferredCols.indexOf(j);
                    const transferredNumber = transferredIndex >= 0 ? current.transferredColsNumbers?.[transferredIndex] : null;
                    
                    return (
                      <Th 
                        key={`h-${j}`} 
                        extra={`bg-gray-100 relative ${current.markedCols[j] ? 'bg-yellow-200' : ''}`}
                      >
                        {j + 1}
                        {current.markedCols[j] && (
                          <div className="absolute top-0 right-0.5 sm:right-1 text-red-600 font-bold text-xs sm:text-sm">+</div>
                        )}
                        {transferredNumber && (
                          <div className="absolute top-0 left-0.5 sm:left-1 text-blue-600 font-bold text-[8px] sm:text-xs">[+{transferredNumber}]</div>
                        )}
                      </Th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {current.matrix.map((row, i) => (
                  <tr key={`r-${i}`}>
                    <Td extra={`bg-gray-100 font-semibold relative ${current.markedRows[i] ? 'bg-yellow-200' : ''}`}>
                      {i + 1}
                      {current.markedRows[i] && (
                        <div className="absolute top-0 right-0.5 sm:right-1 text-red-600 font-bold text-xs sm:text-sm">+</div>
                      )}
                    </Td>
                  {row.map((val, j) => {
                    const mark = current.marks[i][j];
                    const isInCycle = current.cyclePositions?.some(([ci, cj]) => ci === i && cj === j);
                    const isSelected = current.selectedCell?.[0] === i && current.selectedCell?.[1] === j;
                    const isCrossed = current.markedCols[j] || current.markedRows[i];
                    const dependentNumber = current.dependentZeroNumbers?.get(`${i},${j}`);
                    
                    return (
                      <td 
                        key={`c-${i}-${j}`} 
                        className={`relative border px-1 sm:px-2 py-2 sm:py-3 text-center ${
                          isSelected ? 'bg-orange-200' :
                          isInCycle ? 'bg-green-200' :
                          isCrossed ? 'bg-gray-200 line-through' : 
                          val === 0 ? 'bg-blue-50' : 'bg-white'
                        }`}
                      >
                        <div className="text-xs sm:text-sm md:text-base font-medium">
                          {val}
                          {mark === 'independent' && <span className="text-red-600 font-bold">*</span>}
                          {mark === 'dependent' && dependentNumber && <span className="text-blue-600 font-bold">'{dependentNumber}</span>}
                          {mark === 'dependent' && !dependentNumber && <span className="text-blue-600 font-bold">'</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      
      {/* Итоговое решение */}
      {current && cursor === steps.length - 1 && (
        <div className="border rounded p-2 sm:p-3 bg-green-50 mb-2 sm:mb-3">
          <div className="font-semibold text-xs sm:text-sm md:text-base mb-2">Итоговое решение:</div>
          <div className="text-[10px] sm:text-xs md:text-sm mb-2">
            Назначения (строка → столбец):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 sm:gap-2 mb-2 sm:mb-3">
            {current.marks.map((row, i) => {
              const j = row.findIndex(m => m === 'independent');
              if (j !== -1) {
                return (
                  <div key={`assign-${i}`} className="text-[10px] sm:text-xs md:text-sm">
                    Строка {i + 1} → Столбец {j + 1} (стоимость: {matrix[i][j]})
                  </div>
                );
              }
              return null;
            })}
          </div>
          <div className="font-semibold text-sm sm:text-base md:text-lg text-green-700">
            Общая минимальная стоимость: {calculateTotalCost()}
          </div>
        </div>
      )}
      
      {/* Легенда */}
      <div className="text-[9px] sm:text-[10px] md:text-xs text-gray-500 mt-2 sm:mt-3 px-1 sm:px-0">
        <div className="flex flex-wrap gap-1 sm:gap-2 md:gap-4 mb-1 sm:mb-2">
          <span className="flex items-center gap-0.5 sm:gap-1">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-blue-50 border border-gray-300 shrink-0 inline-block"></span>
            Нулевая клетка
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-yellow-200 border border-gray-300 shrink-0 inline-block"></span>
            Помеченная линия (+)
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-gray-200 border border-gray-300 shrink-0 inline-block"></span>
            Зачеркнутая клетка
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-green-200 border border-gray-300 shrink-0 inline-block"></span>
            Клетка в цикле
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 bg-orange-200 border border-gray-300 shrink-0 inline-block"></span>
            Выбранная клетка
          </span>
        </div>
        <div className="flex flex-wrap gap-1 sm:gap-2 md:gap-4">
          <span>0* — независимый ноль</span>
          <span>0' — зависимый ноль</span>
          <span>+ — помеченная линия</span>
        </div>
      </div>
    </div>
  );
}