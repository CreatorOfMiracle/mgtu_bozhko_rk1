import React, { useState } from "react";

/* =================== Типы =================== */
type Matrix = number[][];

interface Edge {
  row: number;
  col: number;
  isMatching?: boolean; // рёбро из паросочетания
  isZero?: boolean; // нулевое ребро
}

interface Step {
  stepIndex: number;
  iterationNumber?: number;
  phase: 'reduction' | 'graph' | 'matching' | 'check' | 'bfs' | 'transpose' | 'modify';
  matrix: Matrix;
  description: string;
  
  // Для редукции
  colReductions?: number[];
  rowReductions?: number[];
  
  // Для графа и паросочетания
  zeroEdges?: Edge[];
  matching?: Edge[];
  
  // Для BFS и множеств
  xPlus?: Set<number>; // строки в X+
  yPlus?: Set<number>; // столбцы в Y+
  xMinus?: Set<number>; // строки в X-
  yMinus?: Set<number>; // столбцы в Y-
  xLabels?: Map<number, BFSLabel>; // метки для вершин X
  yLabels?: Map<number, BFSLabel>; // метки для вершин Y
  uncoveredRows?: Set<number>; // незачёркнутые строки
  uncoveredCols?: Set<number>; // незачёркнутые столбцы
  
  // Для модификации матрицы
  h?: number; // минимальный элемент
  
  // Для чередующегося пути
  augmentingPath?: Edge[]; // рёбра чередующегося пути
  
  // Финальное решение
  isSolution?: boolean;
  totalCost?: number;
}

/* =================== Алгоритм =================== */

// Шаг 1: Редукция матрицы
function reduceMatrix(matrix: Matrix): { reduced: Matrix; colReductions: number[]; rowReductions: number[] } {
  const n = matrix.length;
  const reduced = matrix.map(row => [...row]);
  const colReductions: number[] = [];
  const rowReductions: number[] = [];
  
  // Редукция по столбцам (сначала!)
  for (let j = 0; j < n; j++) {
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      if (reduced[i][j] < min) min = reduced[i][j];
    }
    colReductions.push(min);
    for (let i = 0; i < n; i++) {
      reduced[i][j] -= min;
    }
  }
  
  // Редукция по строкам (потом)
  for (let i = 0; i < n; i++) {
    let min = Math.min(...reduced[i]);
    rowReductions.push(min);
    for (let j = 0; j < n; j++) {
      reduced[i][j] -= min;
    }
  }
  
  return { reduced, colReductions, rowReductions };
}

// Шаг 2: Найти все нулевые рёбра
function findZeroEdges(matrix: Matrix): Edge[] {
  const edges: Edge[] = [];
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] === 0) {
        edges.push({ row: i, col: j, isZero: true });
      }
    }
  }
  
  return edges;
}

// Шаг 3: Найти максимальное паросочетание (по столбцам слева направо, в каждом столбце сверху вниз)
function findMaxMatching(matrix: Matrix): Edge[] {
  const n = matrix.length;
  const matching: Edge[] = [];
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();

  // Идём по столбцам слева направо, в каждом столбце сверху вниз
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (matrix[i][j] === 0 && !usedRows.has(i) && !usedCols.has(j)) {
        matching.push({ row: i, col: j, isMatching: true });
        usedRows.add(i);
        usedCols.add(j);
        break; // Переходим к следующему столбцу после нахождения 0*
      }
    }
  }

  return matching;
}

// Типы для меток BFS
interface BFSLabel {
  order: number; // порядковый номер
  parentIndex: number; // номер родителя (X или Y)
  type: 'x' | 'y';
}

// Шаг 5: Построить множества X+, Y+ через BFS с метками
function buildAugmentingSet(matrix: Matrix, matching: Edge[]): {
  xPlus: Set<number>;
  yPlus: Set<number>;
  xMinus: Set<number>;
  yMinus: Set<number>;
  xLabels: Map<number, BFSLabel>;
  yLabels: Map<number, BFSLabel>;
  foundUnsaturatedY: number | null;
  bfsSteps: string[];
} {
  const n = matrix.length;
  const xPlus = new Set<number>();
  const yPlus = new Set<number>();
  const xLabels = new Map<number, BFSLabel>();
  const yLabels = new Map<number, BFSLabel>();
  const bfsSteps: string[] = [];
  
  // Определить насыщенные вершины (в паросочетании)
  const saturatedRows = new Set(matching.map(e => e.row));
  const saturatedCols = new Set(matching.map(e => e.col));
  
  // Найти первую ненасыщенную строку (вершину X)
  let startRow = -1;
  for (let i = 0; i < n; i++) {
    if (!saturatedRows.has(i)) {
      startRow = i;
      break;
    }
  }
  
  if (startRow === -1) {
    // Все строки насыщены - не должно происходить
    return {
      xPlus: new Set(),
      yPlus: new Set(),
      xMinus: new Set(Array.from({ length: n }, (_, i) => i)),
      yMinus: new Set(Array.from({ length: n }, (_, i) => i)),
      xLabels,
      yLabels,
      foundUnsaturatedY: null,
      bfsSteps
    };
  }
  
  // Инициализация: помечаем стартовую вершину X
  xPlus.add(startRow);
  xLabels.set(startRow, { order: 1, parentIndex: 0, type: 'x' });
  bfsSteps.push(`Начинаем с ненасыщенной вершины X${startRow + 1}, метка [1_0]`);
  
  let orderCounter = 1;
  let foundUnsaturatedY: number | null = null;
  const queue: { index: number; type: 'x' | 'y' }[] = [{ index: startRow, type: 'x' }];
  const processed = new Set<string>();
  
  while (queue.length > 0 && foundUnsaturatedY === null) {
    const current = queue.shift()!;
    const key = `${current.type}-${current.index}`;
    
    if (processed.has(key)) continue;
    processed.add(key);
    
    if (current.type === 'x') {
      // Из X идём в Y по +0 (свободным нулям)
      const row = current.index;
      const currentLabel = xLabels.get(row)!;
      
      for (let col = 0; col < n; col++) {
        if (matrix[row][col] === 0 && !yLabels.has(col)) {
          // Проверяем, это свободный ноль (+0) или из паросочетания (-0)
          const isMatching = matching.some(e => e.row === row && e.col === col);
          
          if (!isMatching) {
            // Это +0, идём в Y
            orderCounter++;
            yPlus.add(col);
            yLabels.set(col, { order: orderCounter, parentIndex: row, type: 'y' });
            bfsSteps.push(`X${row + 1} → Y${col + 1} по +0, метка [${orderCounter}_${row + 1}]`);
            
            // Проверяем, насыщена ли эта вершина Y
            if (!saturatedCols.has(col)) {
              foundUnsaturatedY = col;
              bfsSteps.push(`✓ Найдена ненасыщенная вершина Y${col + 1}! Чередующийся путь найден.`);
              break; // Выходим из for цикла, не добавляем в очередь
            }
            
            queue.push({ index: col, type: 'y' });
          }
        }
      }
      
      // Если нашли ненасыщенную вершину, прекращаем BFS
      if (foundUnsaturatedY !== null) break;
      
    } else {
      // Из Y идём в X по -0 (рёбрам паросочетания)
      const col = current.index;
      const currentLabel = yLabels.get(col);;
      
      // Ищем ребро паросочетания в этом столбце
      const matchingEdge = matching.find(e => e.col === col);
      
      if (matchingEdge && !xLabels.has(matchingEdge.row)) {
        const row = matchingEdge.row;
        orderCounter++;
        xPlus.add(row);
        xLabels.set(row, { order: orderCounter, parentIndex: col, type: 'x' });
        bfsSteps.push(`Y${col + 1} → X${row + 1} по -0 (паросочетание), метка [${orderCounter}_${col + 1}]`);
        
        queue.push({ index: row, type: 'x' });
      }
    }
  }
  
  if (foundUnsaturatedY === null) {
    bfsSteps.push('Ненасыщенная вершина Y не найдена. Все +0 просмотрены → переход к шагу 7');
  }
  
  const xMinus = new Set<number>();
  const yMinus = new Set<number>();
  
  for (let i = 0; i < n; i++) {
    if (!xPlus.has(i)) xMinus.add(i);
  }
  
  for (let j = 0; j < n; j++) {
    if (!yPlus.has(j)) yMinus.add(j);
  }
  
  return { xPlus, yPlus, xMinus, yMinus, xLabels, yLabels, foundUnsaturatedY, bfsSteps };
}

// Шаг 6: Трассировка и аугментация паросочетания
function augmentMatching(
  matching: Edge[],
  endCol: number,
  xLabels: Map<number, BFSLabel>,
  yLabels: Map<number, BFSLabel>
): { newMatching: Edge[]; path: Edge[]; description: string } {
  const pathVertices: Array<{ type: 'X' | 'Y'; index: number }> = [];
  const pathEdges: Edge[] = [];
  
  // Начинаем с найденной ненасыщенной вершины Y
  let currentCol: number | null = endCol;
  let currentRow: number | null = null;

  pathVertices.push({ type: 'Y', index: endCol });

  // Трассировка пути назад по меткам
  while (currentCol !== null) {
    const yLabel = yLabels.get(currentCol);
    if (!yLabel) break;
    
    currentRow = yLabel.parentIndex;
    pathVertices.push({ type: 'X', index: currentRow });
    pathEdges.push({ row: currentRow, col: currentCol }); // +0 ребро (X → Y)

    const xLabel = xLabels.get(currentRow);
    if (!xLabel) break;

    // Проверяем, достигли ли начальной вершины
    if (xLabel.parentIndex === 0 && xLabel.order === 1) {
      // Начало пути - ненасыщенная вершина X
      break;
    } else {
      // Продолжаем по рёбру паросочетания
      currentCol = xLabel.parentIndex;
      if (currentCol !== null) {
        pathVertices.push({ type: 'Y', index: currentCol });
        pathEdges.push({ row: currentRow, col: currentCol }); // -0 ребро (Y → X в паросочетании)
      }
    }
  }

  // Строим новое паросочетание
  const pathEdgesSet = new Set(pathEdges.map(p => `${p.row}-${p.col}`));
  const newMatching: Edge[] = [];

  // Убираем старые рёбра паросочетания, которые есть в пути
  for (const edge of matching) {
    if (!pathEdgesSet.has(`${edge.row}-${edge.col}`)) {
      newMatching.push(edge);
    }
  }

  // Добавляем новые рёбра (которые были +0 в пути, т.е. чётные индексы)
  for (let i = 0; i < pathEdges.length; i++) {
    const edge = pathEdges[i];
    const isAlreadyMatching = matching.some(m => m.row === edge.row && m.col === edge.col);
    if (!isAlreadyMatching) {
      newMatching.push({ ...edge, isMatching: true });
    }
  }
  
  // Формируем строку пути в обратном порядке (от X к Y)
  const pathStr = pathVertices.reverse().map(v => `${v.type}${v.index + 1}`).join(' - ');

  const description = `Найден чередующийся путь: ${pathStr}. Инвертируем рёбра вдоль пути для увеличения паросочетания.`;

  return { newMatching, path: pathEdges, description };
}

// Шаг 7: Модифицировать матрицу
function modifyMatrix(
  matrix: Matrix,
  uncoveredRows: Set<number>,
  uncoveredCols: Set<number>
): { modified: Matrix; h: number } {
  const n = matrix.length;
  
  // Найти минимум h среди клеток на пересечении зачёркнутых строк и незачёркнутых столбцов
  // uncoveredRows - это строки X+, которые НЕ зачёркнуты
  // uncoveredCols - это столбцы Y-, которые НЕ зачёркнуты
  // Значит зачёркнутые строки - это НЕ в uncoveredRows
  // А зачёркнутые столбцы - это НЕ в uncoveredCols
  
  let h = Infinity;
  for (let i = 0; i < n; i++) {
    const rowCovered = !uncoveredRows.has(i); // зачёркнутая строка
    if (!rowCovered) continue; // Пропускаем НЕзачёркнутые строки
    
    for (let j = 0; j < n; j++) {
      const colUncovered = uncoveredCols.has(j); // незачёркнутый столбец
      if (!colUncovered) continue; // Пропускаем зачёркнутые столбцы
      
      // Это пересечение зачёркнутых строк и незачёркнутых столбцов
      if (matrix[i][j] < h) h = matrix[i][j];
    }
  }
  
  const modified = matrix.map(row => [...row]);
  
  // Вычитаем h из клеток на пересечении зачёркнутых строк и незачёркнутых столбцов
  // Прибавляем h к клеткам на пересечении незачёркнутых строк и зачёркнутых столбцов
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rowCovered = !uncoveredRows.has(i); // зачёркнутая строка
      const colCovered = !uncoveredCols.has(j); // зачёркнутый столбец
      
      if (rowCovered && !colCovered) {
        // Зачёркнутая строка, незачёркнутый столбец - вычитаем h
        modified[i][j] -= h;
      } else if (!rowCovered && colCovered) {
        // Незачёркнутая строка, зачёркнутый столбец - прибавляем h
        modified[i][j] += h;
      }
    }
  }
  
  return { modified, h };
}

// Вычислить все шаги
function computeHungarianGraphSteps(initialMatrix: Matrix): Step[] {
  const steps: Step[] = [];
  const n = initialMatrix.length;
  let stepIndex = 0;
  
  // Предварительный этап: Исходная матрица
  steps.push({
    stepIndex: ++stepIndex,
    phase: 'reduction',
    matrix: initialMatrix.map(row => [...row]),
    description: 'Исходная матрица стоимостей',
  });
  
  // Предварительный этап: Редукция
  const { reduced, colReductions, rowReductions } = reduceMatrix(initialMatrix);
  
  steps.push({
    stepIndex: ++stepIndex,
    phase: 'reduction',
    matrix: reduced,
    colReductions,
    rowReductions,
    description: `Редуцированная матрица (вычли из столбцов: [${colReductions.join(', ')}], из строк: [${rowReductions.join(', ')}])`,
  });
  
  let currentMatrix = reduced.map(row => [...row]);
  let iterationCount = 0;
  const maxIterations = 20;
  
  // Построение графа смежности (только в начале)
  let zeroEdges = findZeroEdges(currentMatrix);
  
  steps.push({
    stepIndex: ++stepIndex,
    phase: 'graph',
    matrix: currentMatrix.map(row => [...row]),
    zeroEdges,
    description: `Матрица смежности орграфа Tₘ = (X, Y, ±0) - граф с ${zeroEdges.length} нулевыми рёбрами`,
  });
  
  // Начинаем итерации
  let matching = findMaxMatching(currentMatrix);
  
  while (iterationCount < maxIterations) {
    // Обновляем zeroEdges для текущей матрицы
    zeroEdges = findZeroEdges(currentMatrix);
    
    // Операция 4: Проверка мощности паросочетания
    if (matching.length === n) {
      // Решение найдено!
      let totalCost = 0;
      for (const edge of matching) {
        totalCost += initialMatrix[edge.row][edge.col];
      }
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'check',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching,
        isSolution: true,
        totalCost,
        description: `Итерация ${iterationCount}. Операция 4: Проверка мощности |M| = ${matching.length} = ${n}. Паросочетание совершенно! Решение найдено.`,
      });
      
      // Финальный шаг с исходной матрицей
      steps.push({
        stepIndex: ++stepIndex,
        phase: 'check',
        matrix: initialMatrix.map(row => [...row]),
        matching,
        isSolution: true,
        totalCost,
        description: `Совершенное паросочетание, состоящее из нулей с минусом. Минимальная стоимость: Z* = ${totalCost}`,
      });
      
      break;
    }
    
    steps.push({
      stepIndex: ++stepIndex,
      iterationNumber: iterationCount,
      phase: 'check',
      matrix: currentMatrix.map(row => [...row]),
      zeroEdges,
      matching,
      description: `Итерация ${iterationCount}. Операция 4: Подсчёт мощности паросочетания |M| = ${matching.length} < ${n}. Решение не найдено, переходим к операции 5.`,
    });
    
    // Операция 5: Поиск аугментальной цепи
    const { xPlus, yPlus, xMinus, yMinus, xLabels, yLabels, foundUnsaturatedY, bfsSteps } = buildAugmentingSet(currentMatrix, matching);
    
    steps.push({
      stepIndex: ++stepIndex,
      iterationNumber: iterationCount,
      phase: 'bfs',
      matrix: currentMatrix.map(row => [...row]),
      zeroEdges,
      matching,
      xPlus,
      yPlus,
      xMinus,
      yMinus,
      xLabels,
      yLabels,
      description: `Итерация ${iterationCount}. Операция 5: Поиск аугментальной цепи. ${bfsSteps.join(' → ')}`,
    });

    if (foundUnsaturatedY !== null) {
      // Операция 6 (Аугментация): Найден чередующийся путь, увеличиваем паросочетание
      const { newMatching, path, description: augmentDescription } = augmentMatching(matching, foundUnsaturatedY, xLabels, yLabels);
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'transpose',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching, // Показываем старое паросочетание
        augmentingPath: path, // Добавляем чередующийся путь
        xPlus, yPlus, xLabels, yLabels, // Для визуализации пути
        description: `Итерация ${iterationCount}. Операция 6: ${augmentDescription}`,
      });
      
      // Обновляем паросочетание
      matching = newMatching;
      
      // Инвертируем знаки (меняем статус свет/темн на противоположный)
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'transpose',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching: newMatching, // Показываем новое паросочетание
        augmentingPath: path,
        description: `Итерация ${iterationCount}. Операция 6: Инвертированы знаки нулей вдоль чередующегося пути. Переход к операции 4.`,
      });
      
      // Переходим к следующей итерации с новым паросочетанием
      iterationCount++;
      continue;

    } else {
      // Аугментальная цепь не найдена
      // Очередь Q просмотрена до конца, аугментальной цепи не найдено
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'transpose',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching,
        xPlus,
        yPlus,
        xMinus,
        yMinus,
        description: `Итерация ${iterationCount}. Операция 6: Очередь Q = ∅ просмотрена до конца, но аугментальной цепи не найдено. Управление передаётся операции 7 для изменения состава светлых дуг.`,
      });
      
      // Операция 7: Изменить состав светлых дуг
      // На этой операции меняется состав светлых дуг орграфа T_M
      
      // Находим покрытые/непокрытые строки и столбцы
      const uncoveredRows = xMinus; // строки X- НЕ зачёркиваем
      const uncoveredCols = yMinus; // столбцы Y- НЕ зачёркиваем
      const coveredRows = xPlus; // строки X+ зачёркиваем
      const coveredCols = yPlus; // столбцы Y+ зачёркиваем
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'transpose',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching,
        xPlus,
        yPlus,
        xMinus,
        yMinus,
        uncoveredRows,
        uncoveredCols,
        description: `Итерация ${iterationCount}. Операция 7: Отметки строк и столбцов предыдущей операции. Зачёркиваем строки X⁺={${Array.from(coveredRows).map(i => i+1).join(', ') || '∅'}} и столбцы Y⁺={${Array.from(coveredCols).map(j => j+1).join(', ') || '∅'}}.`,
      });
      
      // Находим минимальный элемент h на пересечении зачёркнутых строк и незачёркнутых столбцов
      const { modified, h } = modifyMatrix(currentMatrix, uncoveredRows, uncoveredCols);
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'modify',
        matrix: currentMatrix.map(row => [...row]),
        zeroEdges,
        matching,
        h,
        uncoveredRows,
        uncoveredCols,
        description: `Итерация ${iterationCount}. Операция 7: Найден минимальный элемент h = ${h} на пересечении зачёркнутых строк и незачёркнутых столбцов. Вычитаем его из всех клеток отмеченных строк и прибавляем ко всем клеткам отмеченных столбцов.`,
      });
      
      steps.push({
        stepIndex: ++stepIndex,
        iterationNumber: iterationCount,
        phase: 'modify',
        matrix: modified,
        matching,
        h,
        description: `Итерация ${iterationCount}. Операция 7: Матрица с изменённым составом светлых дуг. Переход к операции 4.`,
      });
      
      currentMatrix = modified;
      
      // НЕ пересчитываем паросочетание - сохраняем текущее
      // matching остаётся прежним
      
      iterationCount++;
    }
  }
  
  return steps;
}

/* =================== Предопределённые матрицы =================== */
const predefinedMatrices: { [key: string]: Matrix } = {
  'Default': [
    [5, 7, 6, 9, 5],
    [8, 7, 6, 2, 7],
    [8, 9, 13, 10, 10],
    [5, 7, 6, 7, 9],
    [6, 7, 8, 5, 9]
  ],
};

/* =================== Компонент =================== */
export default function HungarianGraphVisualization() {
  const [selectedVariant, setSelectedVariant] = useState('Default');
  const [matrix, setMatrix] = useState<Matrix>(predefinedMatrices['Default']);
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(5);
  const [error, setError] = useState<string>('');
  
  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const [showFinalAnswer, setShowFinalAnswer] = useState(false);
  const current = steps[cursor];
  
  const canPrev = cursor > 0;
  const canNext = cursor < steps.length - 1;
  
  const recompute = () => {
    // Проверяем, что матрица квадратная для венгерского алгоритма
    if (rows !== cols) {
      setError('Ошибка: Для венгерского алгоритма матрица должна быть квадратной (количество строк = количеству столбцов)!');
      return;
    }
    
    // Проверяем, что все клетки заполнены (не пустые и не null)
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (matrix[i][j] === null || matrix[i][j] === undefined || isNaN(matrix[i][j]) || matrix[i][j] === '' as any) {
          setError('Ошибка: Не все клетки заполнены! Заполните все клетки матрицы.');
          return;
        }
      }
    }
    
    setError('');
    const s = computeHungarianGraphSteps(matrix);
    setSteps(s);
    setCursor(0);
  };
  
  const handleVariantChange = (variant: string) => {
    setSelectedVariant(variant);
    const newMatrix = predefinedMatrices[variant];
    if (newMatrix) {
      setRows(newMatrix.length);
      setCols(newMatrix[0].length);
      setMatrix(newMatrix);
      setSteps([]);
      setCursor(0);
      setError('');
    }
  };
  
  const handleRowsChange = (newRows: number) => {
    setRows(newRows);
    // Создаём новую матрицу с новым количеством строк
    const newMatrix: Matrix = Array.from({ length: newRows }, (_, i) => 
      Array.from({ length: cols }, (_, j) => 
        (matrix[i] && matrix[i][j] !== undefined) ? matrix[i][j] : null as any
      )
    );
    setMatrix(newMatrix);
    setSteps([]);
    setCursor(0);
    setError('');
    setSelectedVariant('');
  };
  
  const handleColsChange = (newCols: number) => {
    setCols(newCols);
    // Создаём новую матрицу с новым количеством столбцов
    const newMatrix: Matrix = Array.from({ length: rows }, (_, i) => 
      Array.from({ length: newCols }, (_, j) => 
        (matrix[i] && matrix[i][j] !== undefined) ? matrix[i][j] : null as any
      )
    );
    setMatrix(newMatrix);
    setSteps([]);
    setCursor(0);
    setError('');
    setSelectedVariant('');
  };
  
  const resetAll = () => {
    setSelectedVariant('Default');
    setMatrix(predefinedMatrices['Default']);
    setRows(5);
    setCols(5);
    setSteps([]);
    setCursor(0);
    setError('');
  };
  
  return (
    <div className="p-2 sm:p-4 max-w-7xl mx-auto">
      <h1 className="text-lg sm:text-xl font-bold mb-3">Венгерский алгоритм — графовая реализация (7 шагов)</h1>
      
      {/* Панель управления */}
      <div className="border rounded p-3 bg-white mb-3">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="w-full">
              <label className="block text-xs mb-1">Количество строк</label>
              <input
                type="number"
                min="2"
                max="10"
                value={rows}
                onChange={e => handleRowsChange(Math.max(2, Math.min(10, +e.target.value || 2)))}
                className="border rounded px-2 py-1 w-full text-sm"
              />
            </div>
            <div className="w-full">
              <label className="block text-xs mb-1">Количество столбцов</label>
              <input
                type="number"
                min="2"
                max="10"
                value={cols}
                onChange={e => handleColsChange(Math.max(2, Math.min(10, +e.target.value || 2)))}
                className="border rounded px-2 py-1 w-full text-sm"
              />
            </div>
            <div className="w-full">
              <label className="block text-xs mb-1">Выбор варианта</label>
              <select 
                value={selectedVariant}
                onChange={e => handleVariantChange(e.target.value)}
                className="border rounded px-2 py-1 w-full text-sm"
              >
                <option value="">-- Выберите вариант --</option>
                {Object.keys(predefinedMatrices).map(key => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={recompute} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium">
              Рассчитать
            </button>
            <button onClick={resetAll} className="px-3 py-2 border rounded hover:bg-gray-50 text-sm">
              Сброс
            </button>
          </div>
          {error && (
            <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
              {error}
            </div>
          )}
          {steps.length > 0 && (
            <button 
              onClick={() => setShowFinalAnswer(!showFinalAnswer)} 
              className="w-full px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 text-sm font-medium"
            >
              {showFinalAnswer ? 'Скрыть ответ' : 'Показать ответ'}
            </button>
          )}
        </div>
      </div>
      
      {/* Матрица ввода */}
      <div className="border rounded p-3 bg-white mb-3">
        <div className="font-semibold mb-2 text-sm">Матрица стоимостей</div>
        <div className="overflow-x-auto -mx-3 px-3">
          <table className="border-collapse text-xs min-w-full">
            <tbody>
              {matrix.map((row, i) => (
                <tr key={i}>
                  {row.map((val, j) => (
                    <td key={j} className="border p-1">
                      <input
                        type="number"
                        value={val === null || val === undefined ? '' : val}
                        placeholder="-"
                        onChange={e => {
                          const next = matrix.map(r => [...r]);
                          const inputValue = e.target.value;
                          if (inputValue === '') {
                            next[i][j] = null as any;
                          } else {
                            const numValue = +inputValue;
                            next[i][j] = isNaN(numValue) ? null as any : numValue;
                          }
                          setMatrix(next);
                          setSteps([]);
                          setCursor(0);
                          setError('');
                        }}
                        className="border rounded px-1 py-1 w-12 sm:w-16 text-center text-xs"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Финальный ответ */}
      {showFinalAnswer && steps.length > 0 && (() => {
        // Находим последний шаг с решением
        const solutionStep = steps.find(s => s.isSolution);
        if (!solutionStep || !solutionStep.matching) return null;
        
        return (
          <div className="border-2 border-green-500 rounded p-4 bg-green-50 mb-3">
            <div className="font-bold text-lg mb-3 text-green-800">✓ Оптимальное решение</div>
            
            <div className="bg-white rounded p-2 sm:p-3 mb-3">
              <div className="font-semibold text-sm mb-2">Исходная матрица с выделенным решением:</div>
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="border-collapse border-2 text-xs sm:text-sm mx-auto">
                  <thead>
                    <tr>
                      <th className="border px-1 sm:px-3 py-1 sm:py-2 bg-gray-100"></th>
                      {Array.from({ length: cols }, (_, j) => (
                        <th key={j} className="border px-1 sm:px-3 py-1 sm:py-2 bg-gray-100 text-center">
                          {j + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, i) => (
                      <tr key={i}>
                        <td className="border px-1 sm:px-3 py-1 sm:py-2 font-semibold bg-gray-100 text-center">{i + 1}</td>
                        {row.map((val, j) => {
                          const isInSolution = solutionStep.matching?.some(e => e.row === i && e.col === j);
                          return (
                            <td 
                              key={j}
                              className={`border px-1 sm:px-3 py-1 sm:py-2 text-center font-medium ${
                                isInSolution ? 'bg-green-300 font-bold text-base sm:text-lg' : 'bg-white'
                              }`}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="bg-white rounded p-3">
                <div className="font-semibold text-sm mb-2">Назначения:</div>
                {solutionStep.matching?.map((edge, i) => (
                  <div key={i} className="text-sm py-1">
                    Строка {edge.row + 1} → Столбец {edge.col + 1}
                    <span className="ml-2 text-green-700 font-semibold">
                      (стоимость: {matrix[edge.row][edge.col]})
                    </span>
                  </div>
                ))}
              </div>
              
              <div className="bg-white rounded p-3">
                <div className="font-semibold text-sm mb-2">Итоговая стоимость:</div>
                <div className="text-3xl font-bold text-green-700">
                  {solutionStep.totalCost}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* Навигация */}
      <div className="mb-3">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button 
            disabled={!canPrev} 
            onClick={() => setCursor(c => Math.max(0, c - 1))}
            className={`px-3 py-2 rounded border text-sm font-medium ${canPrev ? "hover:bg-gray-50 active:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}
          >
            ← Назад
          </button>
          <button 
            disabled={!canNext} 
            onClick={() => setCursor(c => Math.min(steps.length - 1, c + 1))}
            className={`px-3 py-2 rounded border text-sm font-medium ${canNext ? "hover:bg-gray-50 active:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}
          >
            Далее →
          </button>
        </div>
        {current && (
          <div className="text-xs text-gray-700 p-2 bg-gray-50 rounded">
            <div><b>Шаг {current.stepIndex}</b> / {steps.length}</div>
            {current.iterationNumber && <div className="text-purple-600">Итерация {current.iterationNumber}</div>}
            <div>Фаза: {current.phase}</div>
            {current.isSolution && <div className="text-green-600 font-semibold">✓ Решение найдено</div>}
          </div>
        )}
      </div>
      
      {/* Описание текущего шага */}
      {current && (
        <>
          {current.iterationNumber && (
            <div className="border-2 border-purple-400 rounded p-2 bg-purple-50 mb-3">
              <div className="font-bold text-base text-purple-700">
                ИТЕРАЦИЯ {current.iterationNumber}
              </div>
            </div>
          )}
          
          <div className="border rounded p-3 bg-blue-50 mb-3">
            <div className="font-semibold text-sm mb-1">Описание:</div>
            <div className="text-xs">{current.description}</div>
          </div>
        </>
      )}
      
                {/* Визуализация */}
      {current && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Матрица */}
          <div className="border rounded p-2 sm:p-3 bg-white">
            <div className="font-semibold text-sm mb-2">Матрица (шаг {current.stepIndex})</div>
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="border-collapse border-2 text-[10px] sm:text-xs mx-auto">
                <thead>
                  <tr>
                    <th className="border px-1 sm:px-2 py-1 bg-gray-100"></th>
                    {Array.from({ length: cols }, (_, j) => {
                      const yLabel = current.yLabels?.get(j);
                      // Зачёркнутые столбцы - это те, которых НЕТ в uncoveredCols
                      const isCrossed = current.uncoveredCols && !current.uncoveredCols.has(j);
                      return (
                        <th 
                          key={j} 
                          className={`border px-1 sm:px-2 py-1 text-center relative ${
                            isCrossed ? 'bg-yellow-200' : 'bg-gray-100'
                          }`}
                        >
                          {yLabel && (
                            <div className="text-purple-600 font-bold text-[8px] sm:text-[10px] whitespace-nowrap mb-1">
                              [{yLabel.order}_{yLabel.parentIndex + 1}]
                            </div>
                          )}
                          <div className={isCrossed ? 'line-through decoration-red-600 decoration-2' : ''}>
                            y{j + 1}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {current.matrix.map((row, i) => {
                    const xLabel = current.xLabels?.get(i);
                    // Зачёркнутые строки - это те, которых НЕТ в uncoveredRows
                    const isCrossed = current.uncoveredRows && !current.uncoveredRows.has(i);
                    return (
                      <tr key={i}>
                        <td 
                          className={`border px-1 sm:px-2 py-1 font-semibold text-center ${
                            isCrossed ? 'bg-yellow-200' : 'bg-gray-100'
                          }`}
                        >
                          {xLabel && (
                            <div className="text-purple-600 font-bold text-[8px] sm:text-[10px] whitespace-nowrap mr-1 inline-block">
                              [{xLabel.order}_{xLabel.order === 1 && xLabel.parentIndex === 0 ? '0' : xLabel.parentIndex + 1}]
                            </div>
                          )}
                          <span className={isCrossed ? 'line-through decoration-red-600 decoration-2' : ''}>
                            x{i + 1}
                          </span>
                        </td>
                        {row.map((val, j) => {
                        const isMatching = current.matching?.some(e => e.row === i && e.col === j);
                        const isInAugmentingPath = current.augmentingPath?.some(e => e.row === i && e.col === j);
                        const isZero = val === 0;
                        const isCovered = (current.uncoveredRows && !current.uncoveredRows.has(i)) || 
                                         (current.uncoveredCols && !current.uncoveredCols.has(j));
                        
                        // Определяем отображение нулей
                        let displayValue: string | number = val;
                        let showSubscript = false;
                        
                        if (isZero) {
                          // В начале (graph и reduction) - просто 0
                          if (current.phase === 'reduction' || current.phase === 'graph') {
                            displayValue = '0';
                          } 
                          // Если есть паросочетание, показываем -0 и +0
                          else if (current.matching && current.matching.length > 0) {
                            if (isMatching) {
                              displayValue = '-0';
                              showSubscript = true;
                            } else {
                              displayValue = '+0';
                              showSubscript = true;
                            }
                          } else {
                            displayValue = '0';
                          }
                        }
                        
                        return (
                          <td 
                            key={j}
                            className={`border px-1 sm:px-2 py-1 sm:py-2 text-center ${
                              isInAugmentingPath ? 'bg-orange-300 font-bold' :
                              isMatching && !current.isSolution ? 'bg-green-200 font-bold' :
                              current.isSolution && isMatching ? 'bg-green-300 font-bold' :
                              isZero ? 'bg-blue-50' :
                              isCovered ? 'bg-gray-200' :
                              'bg-white'
                            }`}
                          >
                            <div className="text-[10px] sm:text-xs font-medium">
                              {displayValue}
                              {showSubscript && isInAugmentingPath && <sub className="text-[8px]">→</sub>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            
            {current.h !== undefined && (
              <div className="mt-2 text-xs text-purple-600 font-semibold">
                Минимальный элемент h = {current.h}
              </div>
            )}
          </div>
          
          {/* Граф */}
          <div className="border rounded p-2 sm:p-3 bg-white">
            <div className="font-semibold text-sm mb-2">Двудольный граф</div>
            <svg viewBox="0 0 400 300" className="w-full h-48 sm:h-64 border">
              {/* Левая часть X (строки) */}
              {Array.from({ length: rows }, (_, i) => {
                const y = 50 + (i * 200) / Math.max(1, rows - 1);
                const isInXPlus = current.xPlus?.has(i);
                const isInXMinus = current.xMinus?.has(i);
                const xLabel = current.xLabels?.get(i);
                
                return (
                  <g key={`x-${i}`}>
                    <circle 
                      cx={80} 
                      cy={y} 
                      r={15} 
                      fill={isInXPlus ? '#fef08a' : isInXMinus ? '#e5e7eb' : '#dbeafe'}
                      stroke="#1e40af" 
                      strokeWidth="2"
                    />
                    <text x={80} y={y + 4} textAnchor="middle" className="text-xs font-semibold">
                      X{i + 1}
                    </text>
                    {xLabel && (
                      <text x={50} y={y - 20} className="text-[10px] font-bold fill-purple-600">
                        [{xLabel.order}_{xLabel.parentIndex === 0 ? '0' : xLabel.parentIndex + 1}]
                      </text>
                    )}
                  </g>
                );
              })}
              
              {/* Правая часть Y (столбцы) */}
              {Array.from({ length: cols }, (_, j) => {
                const y = 50 + (j * 200) / Math.max(1, cols - 1);
                const isInYPlus = current.yPlus?.has(j);
                const isInYMinus = current.yMinus?.has(j);
                const yLabel = current.yLabels?.get(j);
                
                return (
                  <g key={`y-${j}`}>
                    <circle 
                      cx={320} 
                      cy={y} 
                      r={15} 
                      fill={isInYPlus ? '#fef08a' : isInYMinus ? '#e5e7eb' : '#fecaca'}
                      stroke="#dc2626" 
                      strokeWidth="2"
                    />
                    <text x={320} y={y + 4} textAnchor="middle" className="text-xs font-semibold">
                      Y{j + 1}
                    </text>
                    {yLabel && (
                      <text x={345} y={y - 20} className="text-[10px] font-bold fill-purple-600">
                        [{yLabel.order}_{yLabel.parentIndex + 1}]
                      </text>
                    )}
                  </g>
                );
              })}
              
              {/* Рёбра */}
              {current.zeroEdges?.map((edge, idx) => {
                const y1 = 50 + (edge.row * 200) / Math.max(1, rows - 1);
                const y2 = 50 + (edge.col * 200) / Math.max(1, cols - 1);
                const isMatching = current.matching?.some(e => e.row === edge.row && e.col === edge.col);
                const isInAugmentingPath = current.augmentingPath?.some(e => e.row === edge.row && e.col === edge.col);
                
                return (
                  <line
                    key={`edge-${idx}`}
                    x1={95}
                    y1={y1}
                    x2={305}
                    y2={y2}
                    stroke={isInAugmentingPath ? '#f97316' : isMatching ? '#16a34a' : '#94a3b8'}
                    strokeWidth={isInAugmentingPath ? 4 : isMatching ? 3 : 1}
                    strokeDasharray={isMatching ? '0' : '5,5'}
                  />
                );
              })}
            </svg>
            
            <div className="mt-2 text-[10px] sm:text-xs space-y-1">
              {current.matching && (
                <div>
                  <span className="font-semibold">Паросочетание:</span> {current.matching.length} рёбер
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-1">
                    {current.matching.map((e, i) => (
                      <div key={i} className="text-green-600">
                        X{e.row + 1} → Y{e.col + 1}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {current.xPlus && (
                <div className="text-purple-600">
                  <span className="font-semibold">X⁺:</span> {Array.from(current.xPlus).map(i => `X${i+1}`).join(', ')}
                </div>
              )}
              {current.yPlus && (
                <div className="text-purple-600">
                  <span className="font-semibold">Y⁺:</span> {Array.from(current.yPlus).map(j => `Y${j+1}`).join(', ')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Итоговое решение */}
      {current?.isSolution && (
        <div className="border rounded p-3 bg-green-50 mt-3">
          <div className="font-semibold text-base mb-2">✓ Решение найдено!</div>
          <div className="text-sm mb-2">Оптимальные назначения:</div>
          <div className="space-y-1 mb-3">
            {current.matching?.map((edge, i) => (
              <div key={i} className="text-xs sm:text-sm bg-white p-2 rounded">
                Строка {edge.row + 1} → Столбец {edge.col + 1} 
                {cursor === steps.length - 1 && (
                  <span className="ml-2 text-green-700 font-semibold">
                    (стоимость: {current.matrix[edge.row][edge.col]})
                  </span>
                )}
              </div>
            ))}
          </div>
          {current.totalCost !== undefined && (
            <div className="font-semibold text-base sm:text-lg text-green-700 bg-white p-2 rounded">
              Общая минимальная стоимость: {current.totalCost}
            </div>
          )}
        </div>
      )}
      
      {/* Описание алгоритма */}
      <div className="border rounded p-3 bg-blue-50 mt-3">
        <div className="font-semibold text-sm mb-2">7 шагов графовой реализации венгерского алгоритма:</div>
        <div className="text-[11px] sm:text-xs space-y-2">
          <div>
            <strong>Шаг 1. Редукция матрицы:</strong> Из каждой строки вычитаем минимальный элемент, затем из каждого столбца вычитаем минимальный элемент. Получаем хотя бы один ноль в каждой строке и столбце.
          </div>
          
          <div>
            <strong>Шаг 2. Построение нулевого графа:</strong> Строим двудольный граф X-Y, где рёбра соответствуют нулевым элементам матрицы.
          </div>
          
          <div>
            <strong>Шаг 3. Максимальное паросочетание:</strong> Находим максимальное паросочетание среди нулевых рёбер (набор рёбер, которые не имеют общих вершин).
          </div>
          
          <div>
            <strong>Шаг 4. Проверка мощности:</strong> Если |M| = n (паросочетание совершенно), то решение найдено. Иначе переходим к шагу 5.
          </div>
          
          <div>
            <strong>Шаг 5. Построение множеств X⁺, Y⁺:</strong> Начинаем с непокрытых вершин из X (несопряжённые строки) и проводим поиск в ширину (BFS):
            <ul className="list-disc ml-5 mt-1">
              <li>Из X⁺ идём по нулевым рёбрам в Y⁺</li>
              <li>Из Y⁺ идём по рёбрам паросочетания обратно в X⁺</li>
              <li>X⁻ = X \ X⁺, Y⁻ = Y \ Y⁺</li>
            </ul>
          </div>
          
          <div>
            <strong>Шаг 6. Построение покрытия:</strong> Покрываем линиями строки из X⁻ и столбцы из Y⁺. Это минимальное покрытие всех нулей.
          </div>
          
          <div>
            <strong>Шаг 7. Модификация матрицы:</strong> Находим минимум h среди непокрытых клеток (клетки в X⁺ ∩ Y⁻):
            <ul className="list-disc ml-5 mt-1">
              <li>Вычитаем h из всех непокрытых клеток</li>
              <li>Прибавляем h к дважды покрытым клеткам (пересечение покрытых строк и столбцов)</li>
              <li>Возвращаемся к шагу 3</li>
            </ul>
          </div>
        </div>
      </div>
      
      {/* Легенда */}
      <div className="text-[10px] sm:text-xs text-gray-500 mt-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-blue-50 border inline-block flex-shrink-0"></span>
            <span className="truncate">Нулевая клетка</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-green-200 border inline-block flex-shrink-0"></span>
            <span className="truncate">Паросочетание *</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-orange-300 border inline-block flex-shrink-0"></span>
            <span className="truncate">Чередующийся путь</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-yellow-200 border inline-block flex-shrink-0"></span>
            <span className="truncate">Покрытая линия ✓</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 bg-gray-200 border inline-block flex-shrink-0"></span>
            <span className="truncate">Покрытая клетка</span>
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-yellow-300 border-2 border-purple-500 inline-block flex-shrink-0"></span>
            <span>Вершина в X⁺ или Y⁺</span>
          </span>
          <span>Зелёные линии — паросочетание</span>
          <span>Оранжевые линии — чередующийся путь</span>
          <span>Пунктир — нулевые рёбра</span>
        </div>
      </div>
    </div>
  );
}