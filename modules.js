/**
 * ---------------------------------------------------------------------
 * メインスクリプト
 * ---------------------------------------------------------------------
 * UI操作、状態管理、およびWebAssembly(WASM)でコンパイルされたソルバーとの連携を担います
 */

// --- WASMモジュールの初期化 ---
// WASMファイルからソルバー関数をインポートし、非同期で初期化
import init, { solve_puzzle } from './pkg/picross_solver.js';
async function run() { await init(); }
run();

// --- 定数とグローバル状態 ---

/**
 * セルの状態を表す定数
 * @readonly
 * @enum {number}
 */
const CELL_STATE = { EMPTY: 0, FILLED: 1, CROSSED: 2 };

/** @type {number} 盤面の最大サイズ */
const MAX_SIZE = 100;

/**
 * アプリケーション全体の状態を管理するオブジェクト
 * @type {{
 * rows: number;
 * cols: number;
 * rowRules: number[][];
 * colRules: number[][];
 * grid: number[][];
 * isSolving: boolean;
 * }}
 */
let state = {
  rows: 10,       // 盤面の行数
  cols: 10,       // 盤面の列数
  rowRules: Array(10).fill([]), // 各行のルールを保持する2次元配列
  colRules: Array(10).fill([]), // 各列のルールを保持する2次元配列
  grid: Array(10).fill(null).map(() => Array(10).fill(CELL_STATE.EMPTY)), // 盤面の各セルの状態を保持する2次元配列
  isSolving: false, // 解析中かどうかを示すフラグ
};

// --- DOM要素の取得 ---
// 一括入力用のテキストエリア要素を取得
const rowRulesTextarea = document.getElementById('row-rules-textarea');
const colRulesTextarea = document.getElementById('col-rules-textarea');

// OCRステータス表示用の要素を取得
const ocrStatusEl = document.getElementById('ocr-status');
const ocrStatusTextEl = document.getElementById('ocr-status-text');
const ocrProgressEl = document.getElementById('ocr-progress');

// --- UIレンダリング関数 ---

/**
 * UI全体を現在のstateに基づいて再描画
 */
function render() {
  renderRules();
  renderGrid();
}

/**
 * 個別入力用のルール欄を現在のstateに基づいて再描画
 */
function renderRules() {
  const rowRulesContainer = document.getElementById('row-rules-container');
  const colRulesContainer = document.getElementById('col-rules-container');
  rowRulesContainer.innerHTML = '';
  colRulesContainer.innerHTML = '';
  rowRulesContainer.style.gridTemplateRows = `repeat(${state.rows}, minmax(32px, 1fr))`;
  colRulesContainer.style.gridTemplateColumns = `repeat(${state.cols}, minmax(32px, 1fr))`;

  // state.rowRulesに基づいて、行の個別入力欄を動的に生成
  for (let i = 0; i < state.rows; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rule-input-wrapper';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-input';
    input.dataset.index = i;
    input.dataset.type = 'row';
    input.value = state.rowRules[i] ? state.rowRules[i].join(' ') : '';
    wrapper.appendChild(input);
    rowRulesContainer.appendChild(wrapper);
  }

  // state.colRulesに基づいて、列の個別入力欄を動的に生成
  for (let i = 0; i < state.cols; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rule-input-wrapper';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-input';
    input.dataset.index = i;
    input.dataset.type = 'col';
    input.value = state.colRules[i] ? state.colRules[i].join(' ') : '';
    wrapper.appendChild(input);
    colRulesContainer.appendChild(wrapper);
  }
}

/**
 * ピクロスの盤面を現在のstate.gridに基づいて再描画
 */
function renderGrid() {
  const gridContainer = document.getElementById('grid-container');
  gridContainer.innerHTML = '';
  gridContainer.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
  gridContainer.style.gridTemplateRows = `repeat(${state.rows}, 1fr)`;

  // 2重ループで全てのセルを生成
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      const cellState = state.grid[r][c];
      // セルの状態に応じて、CSSクラスや×印(SVG)を追加
      if (cellState === CELL_STATE.FILLED) { cell.classList.add('filled'); }
      else if (cellState === CELL_STATE.CROSSED) {
        cell.classList.add('crossed');
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "cross-icon"); svg.setAttribute("viewBox", "0 0 24 24");
        const line1 = document.createElementNS(svgNS, "line");
        line1.setAttribute("x1", "18"); line1.setAttribute("y1", "6"); line1.setAttribute("x2", "6"); line1.setAttribute("y2", "18");
        const line2 = document.createElementNS(svgNS, "line");
        line2.setAttribute("x1", "6"); line2.setAttribute("y1", "6"); line2.setAttribute("x2", "18"); line2.setAttribute("y2", "18");
        [line1, line2].forEach(l => {
          l.setAttribute("stroke", "currentColor"); l.setAttribute("stroke-width", "2.5");
          l.setAttribute("stroke-linecap", "round"); l.setAttribute("stroke-linejoin", "round");
        });
        svg.appendChild(line1); svg.appendChild(line2);
        cell.appendChild(svg);
      }
      gridContainer.appendChild(cell);
    }
  }
}

/**
 * ユーザーにメッセージを表示
 * @param {string} text 表示するテキスト
 * @param {'info' | 'error'} [type='info'] メッセージの種類
 */
function showMessage(text, type = 'info') {
  const msgArea = document.getElementById('message-area');
  msgArea.textContent = text;
  msgArea.className = type;
  msgArea.style.display = 'block';
}

/**
 * 表示されているメッセージを隠
 */
function hideMessage() { document.getElementById('message-area').style.display = 'none'; }

// --- イベントハンドラ ---

/**
 * サイズ入力欄の値が変更されたときに実行
 * stateをリセットし、UI全体を再描画
 */
function handleSizeChange() {
  const rowsInput = document.getElementById('rows-input');
  const colsInput = document.getElementById('cols-input');
  const newRows = Math.max(1, Math.min(MAX_SIZE, parseInt(rowsInput.value, 10) || 1));
  const newCols = Math.max(1, Math.min(MAX_SIZE, parseInt(colsInput.value, 10) || 1));
  rowsInput.value = newRows;
  colsInput.value = newCols;

  // 新しいサイズでstateオブジェクトを再生成
  state = {
    rows: newRows, cols: newCols,
    rowRules: Array(newRows).fill([]), colRules: Array(newCols).fill([]),
    grid: Array(newRows).fill(null).map(() => Array(newCols).fill(CELL_STATE.EMPTY)),
    isSolving: false,
  };
  // サイズ変更時に一括入力テキストエリアもクリア
  rowRulesTextarea.value = '';
  colRulesTextarea.value = '';
  hideMessage();
  render();
}

/**
 * 個別ルール入力欄の値が変更されたときに実行
 * @param {Event} event イベントオブジェクト
 */
function handleRuleChange(event) {
  const input = event.target;
  // イベントがルール入力欄以外で発生した場合は無視
  if (!input.classList.contains('rule-input')) return;

  const index = parseInt(input.dataset.index, 10);
  const type = input.dataset.type;
  const parsedRule = input.value.split(/[\s,]+/).filter(n => n).map(Number);
  // 入力が数字でない場合はエラーメッセージを表示
  if (parsedRule.some(isNaN)) {
    showMessage(`ルールには数字を入力してください`, 'error'); return;
  }
  // stateの対応するルールを更新
  if (type === 'row') { state.rowRules[index] = parsedRule; }
  else { state.colRules[index] = parsedRule; }
}

/**
 * 盤面のセルがクリックされたときに実行
 * セルの状態を EMPTY -> FILLED -> CROSSED の順で切り替えます
 * @param {MouseEvent} event イベントオブジェクト
 */
function handleCellClick(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const r = parseInt(cell.dataset.row, 10);
  const c = parseInt(cell.dataset.col, 10);
  state.grid[r][c] = (state.grid[r][c] + 1) % 3; // 0, 1, 2をループさせる
  hideMessage();
  renderGrid(); // グリッドのみ再描画
}

/**
 * 一括入力の「ルールを反映」ボタンがクリックされたときに実行
 * テキストエリアの内容をパースし、個別入力欄に反映させます
 */
function handleBulkReflect() {
  /**
   * テキストエリアの値をパースしてルールの2次元配列に変換する内部関数
   * @param {HTMLTextAreaElement} textarea パース対象のテキストエリア
   * @returns {number[][]} パース後のルールの配列
   */
  const parseRules = (textarea) => {
    return textarea.value.trim().split('\n').map(line => {
      const trimmedLine = line.trim();
      // 空行や"0"のみの行は、ルールなし（[]）として扱います
      if (trimmedLine === '' || trimmedLine === '0') return [];
      return trimmedLine.split(/[\s,]+/).map(Number);
    });
  };

  const newRowRules = parseRules(rowRulesTextarea);
  const newColRules = parseRules(colRulesTextarea);

  // パース結果に数字以外のものが含まれていないかチェック
  if (newRowRules.some(r => r.some(isNaN)) || newColRules.some(r => r.some(isNaN))) {
    showMessage('ルールには数字のみを入力してください', 'error');
    return;
  }

  // stateのルールを、現在の盤面サイズに合わせて更新
  // テキストエリアの行数が盤面の行数より多くても、はみ出た分は無視
  for (let i = 0; i < state.rows; i++) {
    state.rowRules[i] = newRowRules[i] || [];
  }
  for (let i = 0; i < state.cols; i++) {
    state.colRules[i] = newColRules[i] || [];
  }

  // stateの変更を個別入力欄に反映させるためにrenderRulesを呼び出
  renderRules();
  showMessage('ルールを個別入力欄に反映しました', 'info');
}

/**
 * 「確定マスを探す」ボタンがクリックされたときに実行
 * WASMソルバーを呼び出し、結果を盤面に反映
 */
function handleSolve() {
  if (state.isSolving) return;
  state.isSolving = true;
  document.getElementById('solve-button').disabled = true;
  document.getElementById('solve-button').textContent = "解析中...";
  showMessage('解析中...');
  // UIの更新を待ってから重い処理を行うため、setTimeoutを使用
  setTimeout(() => {
    try {
      // WASM関数を呼び出す
      const result = solve_puzzle(state.rows, state.cols, state.rowRules, state.colRules, state.grid);
      // 解析結果でstateを更新
      state.grid = result.grid;
      showMessage(result.message, result.error ? 'error' : 'info');
      renderGrid();
    } catch (e) {
      console.error("WASM Error:", e);
      showMessage('解析中に予期せぬエラーが発生しました', 'error');
    } finally {
      // 成功・失敗にかかわらず、ボタンの状態を元に戻す
      resetSolveState();
    }
  }, 50);
}

/**
 * 「リセット」ボタンがクリックされたときに実行
 * 盤面のセルの状態のみをリセット（ルールは維持）
 */
function handleReset() {
  state.grid = Array(state.rows).fill(null).map(() => Array(state.cols).fill(CELL_STATE.EMPTY));
  showMessage('盤面をリセットしました');
  renderGrid();
}

/**
 * 解析ボタンの状態を元に戻す
 */
function resetSolveState() {
  state.isSolving = false;
  const solveButton = document.getElementById('solve-button');
  solveButton.disabled = false;
  solveButton.textContent = "確定マスを探す";
}

/**
 * OCR結果のテキストを整形して、ルールとして使える形式の文字列に変換
 * @param {string} rawText - Tesseract.jsから返された生のテキスト
 * @param {boolean} isColumn - 列ルールの場合はtrue改行をスペースに置換
 * @returns {string} 整形後のテキスト
 */
function cleanOcrResult(rawText, isColumn = false) {
  // 誤認識しやすい文字を置換（例: O→0, l→1）
  let text = rawText.replace(/[oO]/g, '0').replace(/[lI]/g, '1');

  // 列ルールの場合は縦書きの可能性が高く、改行が数字の区切りになっている場合があるため、
  // 改行をスペースに置換して横書きのルール形式に近づけます
  if (isColumn) {
    text = text.replace(/\n/g, ' ');
  }

  // 数字、スペース、改行以外の不要な文字を削除
  const cleaned = text.replace(/[^0-9\s\n]/g, '');
  // 複数の空行を一つにまとめ、前後の空白を削除
  return cleaned.replace(/\n\s*\n/g, '\n').trim();
}

/**
 * Canvasを使って画像を白黒の二値化画像に変換
 * @param {File} file - 処理対象の画像ファイル
 * @returns {Promise<string>} 二値化された画像のData URL
 */
function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // 画像データを取得
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const threshold = 128; // 二値化の閾値 (0-255)画像の明るさに応じて調整が必要な場合があります

        // ピクセルを一つずつ処理
        for (let i = 0; i < data.length; i += 4) {
          // RGBの平均値を輝度として計算
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // 閾値より暗ければ黒、明るければ白に設定
          const value = brightness < threshold ? 0 : 255;
          data[i] = data[i + 1] = data[i + 2] = value;
        }

        // 処理後の画像データをCanvasに戻す
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 画像ファイルに対してTesseract.jsによるOCRを実行
 * @param {File} file - ユーザーが選択した画像ファイル
 * @param {HTMLTextAreaElement} targetTextarea - 結果を反映させるテキストエリア
 * @param {boolean} isColumn - 列ルールかどうか
 */
async function runOcr(file, targetTextarea, isColumn = false) {
  if (!file) return;

  ocrStatusEl.classList.remove('hidden');
  ocrProgressEl.value = 0;

  try {
    // --- 方法2: 画像の前処理を実行 ---
    ocrStatusTextEl.textContent = '画像の前処理中...';
    const processedImage = await preprocessImage(file);

    // Tesseract.jsのワーカーを生成
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        console.log(m); // デバッグ用にコンソールに進捗を出力
        if (m.status === 'recognizing text') {
          ocrStatusTextEl.textContent = `文字を認識中... (${Math.round(m.progress * 100)}%)`;
          ocrProgressEl.value = m.progress;
        } else if (m.status.startsWith('loading language')) {
          ocrStatusTextEl.textContent = '言語データを準備中...';
        } else {
          ocrStatusTextEl.textContent = '処理を準備中...';
        }
      },
    });

    // --- 方法1: Tesseract.jsの設定を最適化 ---
    await worker.setParameters({
      // 認識対象を数字(0-9)、スペース、改行のみに限定
      tessedit_char_whitelist: '0123456789 \n',
      // 画像を単一のテキストブロックとして扱うように設定
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    // OCRを実行
    const { data: { text } } = await worker.recognize(processedImage);
    // 結果を整形してテキストエリアに反映
    targetTextarea.value = cleanOcrResult(text, isColumn);

    await worker.terminate();
    showMessage('画像の読み込みが完了しました結果を確認・修正してください', 'info');

  } catch (error) {
    console.error('OCR Error:', error);
    showMessage('OCR処理中にエラーが発生しました詳細はコンソールを確認してください', 'error');
  } finally {
    ocrStatusEl.classList.add('hidden');
  }
}


// --- イベントリスナーの登録 ---
document.getElementById('rows-input').addEventListener('change', handleSizeChange);
document.getElementById('cols-input').addEventListener('change', handleSizeChange);
document.getElementById('solve-button').addEventListener('click', handleSolve);
document.getElementById('reset-button').addEventListener('click', handleReset);
document.querySelector('.picross-container').addEventListener('change', handleRuleChange);
document.getElementById('grid-container').addEventListener('click', handleCellClick);
document.getElementById('reflect-bulk-rules-button').addEventListener('click', handleBulkReflect);
document.getElementById('row-ocr-input').addEventListener('change', (e) => runOcr(e.target.files[0], rowRulesTextarea));
document.getElementById('col-ocr-input').addEventListener('change', (e) => runOcr(e.target.files[0], colRulesTextarea));

// 初期描画
render();