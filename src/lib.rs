//! ソルバーのコアロジックを実装したRustライブラリ
//! このコードはWebAssembly(WASM)にコンパイルされ、JavaScriptから呼び出されることを想定しています

use wasm_bindgen::prelude::*;
// serdeクレートから、Rustのデータ構造とJSONのようなシリアライズ可能な形式との間で相互変換を行うためのSerializeとDeserializeトレイトをインポート
use serde::{Deserialize, Serialize};

/// WASM実行中にRustコードがパニック（回復不能なエラー）を起こした際に、ブラウザの開発者コンソールに詳細なエラー情報を出力するためのフックを設定
#[cfg(feature = "console_error_panic_hook")]
pub use console_error_panic_hook::set_once as set_panic_hook;

// --- データ構造の定義 ---

/// 各セルの状態を表すenum（列挙型）
#[wasm_bindgen]
#[repr(u8)] // enumの各バリアントが内部的にu8型の数値として表現されることをコンパイラに伝えます
#[derive(Clone, Copy, Debug, PartialEq, Eq)] // 型の基本的な振る舞い（コピー、デバッグ表示、比較）を自動実装
pub enum CellState {
    Empty = 0,
    Filled = 1,
    Crossed = 2,
}

/// `CellState` enumを他のデータ形式（例: JSON）に変換（シリアライズ）する際のルールを手動で実装
/// これにより、JavaScript側には常に数値(u8)としてデータが渡されることを保証
impl Serialize for CellState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // enumのバリアントを、`#[repr(u8)]`で定義された対応するu8型の数値としてシリアライズ
        // 例: `CellState::Crossed` は `2` という数値になります
        serializer.serialize_u8(*self as u8)
    }
}

/// 他のデータ形式から`CellState` enumに変換（デシリアライズ）する際のルールを手動で実装
/// JavaScriptの`Number`型は整数と浮動小数点数を区別しないため、両方を受け入れられるようにする
impl<'de> Deserialize<'de> for CellState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Visitorパターンを使い、様々な型のデータに対応
        struct CellStateVisitor;

        impl<'de> serde::de::Visitor<'de> for CellStateVisitor {
            type Value = CellState;

            // エラー時に表示されるメッセージを定義
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("an integer or float representing a cell state (0, 1, or 2)")
            }

            // 符号なし64ビット整数(u64)から変換する場合の処理
            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                match value {
                    0 => Ok(CellState::Empty),
                    1 => Ok(CellState::Filled),
                    2 => Ok(CellState::Crossed),
                    _ => Err(E::custom(format!("invalid cell state: {}", value))),
                }
            }

            // 符号あり64ビット整数(i64)から変換する場合の処理u64にキャストして再利用
            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_u64(value as u64)
            }

            // 64ビット浮動小数点数(f64)から変換する場合の処理四捨五入してu64に変換
            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_u64(value.round() as u64)
            }
        }
        
        // 渡されたデータの型に応じて、適切なvisit_*メソッドを呼び出すようにデシリアライザに依頼
        deserializer.deserialize_any(CellStateVisitor)
    }
}

/// 解析結果をJavaScriptに返すためのデータ構造（struct）
#[derive(Serialize, Deserialize)]
pub struct SolveResult {
    grid: Vec<Vec<CellState>>, // 更新された盤面の状態
    message: String,           // ユーザーに表示するメッセージ
    error: bool,               // エラーが発生したかどうかを示すフラグ
}

// --- コアロジック関数 ---

/// 1行または1列（ライン）を解析し、確定できるマスを導き出す関数
///
/// # Arguments
/// * `line_size` - 解析対象ラインの長さ（列数または行数）
/// * `rule` - そのラインに適用されるルール（例: `[2, 1]`）
/// * `user_line` - 現在のラインの状態（ユーザーの入力や前回の解析結果を含む）
///
/// # Returns
/// * `Ok(Vec<CellState>)` - 更新されたラインの状態
/// * `Err(String)` - 矛盾などが発生した場合のエラーメッセージ
fn solve_line(
    line_size: usize,
    rule: &[usize],
    user_line: &[CellState],
) -> Result<Vec<CellState>, String> {
    // ルールが空、または[0]のみの場合、そのラインは全て「×」(Crossed)で確定
    if rule.is_empty() || (rule.len() == 1 && rule[0] == 0) {
        let mut new_line = user_line.to_vec();
        for i in 0..line_size {
            // もし既に「塗り」のマスがあれば、ルールと矛盾するのでエラー
            if user_line[i] == CellState::Filled {
                return Err("入力に矛盾があります".to_string());
            }
            new_line[i] = CellState::Crossed;
        }
        return Ok(new_line);
    }

    // 1. ルールに合致する全ての可能性のある配置パターンを生成する
    let possibilities = generate_possibilities(line_size, rule);

    // 2. 生成された全パターンの中から、現在のラインの状態(`user_line`)と矛盾しないものだけを絞り込む
    let valid_possibilities: Vec<_> = possibilities
        .into_iter()
        .filter(|p| {
            // p は一つの可能性パターン (例: [1, 1, 0, 1, 0])
            (0..line_size).all(|i| match user_line[i] {
                // 既に「塗り」のマスは、パターンでも「塗り」(1)でなければならない
                CellState::Filled => p[i] == 1,
                // 既に「×」のマスは、パターンでも「空」(0)でなければならない
                CellState::Crossed => p[i] == 0,
                // 「空」のマスはどんなパターンでもOK
                CellState::Empty => true,
            })
        })
        .collect();

    // 矛盾しないパターンが一つもなければ、入力に矛盾があるということ
    if valid_possibilities.is_empty() {
        return Err("入力に矛盾があります".to_string());
    }

    // 3. 矛盾しない全パターンで共通しているマスを特定する
    let mut new_line = user_line.to_vec();
    for i in 0..line_size {
        // 既に確定しているマスはスキップ
        if new_line[i] != CellState::Empty {
            continue;
        }

        // 最初の有効なパターンのi番目の状態を取得
        let first_state = valid_possibilities[0][i];
        // 全ての有効なパターンで、i番目の状態が `first_state` と同じかチェック
        if valid_possibilities.iter().all(|p| p[i] == first_state) {
            // 全て同じであれば、そのマスは確定できる
            new_line[i] = if first_state == 1 {
                CellState::Filled // 全て1なら「塗り」
            } else {
                CellState::Crossed // 全て0なら「×」
            };
        }
    }

    // 更新されたラインを返す
    Ok(new_line)
}

/// ルールに基づいて、考えられる全ての「塗り」の配置パターンを生成する再帰関数
///
/// # Arguments
/// * `size` - ラインの長さ
/// * `rule` - 適用するルール
///
/// # Returns
/// * `Vec<Vec<u8>>` - 考えられる全てのパターン（`1`が塗り、`0`が空）のリスト
fn generate_possibilities(size: usize, rule: &[usize]) -> Vec<Vec<u8>> {
    let mut solutions = Vec::new();
    let mut current_arrangement = vec![0; size];

    // 再帰的に探索を行う内部関数
    fn recurse(
        size: usize,
        rule: &[usize],
        block_index: usize, // 現在配置しようとしているルールのインデックス
        start_index: usize, // 現在のブロックを配置し始めることができる、最小のインデックス
        current_arrangement: &mut Vec<u8>, // 現在の配置状態
        solutions: &mut Vec<Vec<u8>>, // 完成したパターンの保存場所
    ) {
        // ベースケース: 全てのルールブロックを配置し終えたら、現在の配置を解として保存
        if block_index == rule.len() {
            solutions.push(current_arrangement.clone());
            return;
        }

        // これから配置するブロックの長さ
        let block_length = rule[block_index];
        // このブロックより後に続くブロックが必要とする最小スペース（ブロック長 + 区切りの1マス）
        let space_for_remaining: usize = if block_index + 1 < rule.len() {
            rule[block_index + 1..].iter().sum::<usize>() + (rule.len() - 1 - block_index)
        } else {
            0
        };
        // 現在のブロックを配置できる、最も遅い（右側の）開始位置
        let latest_start = size - space_for_remaining - block_length;

        // 再帰ステップ: start_indexからlatest_startまで、ブロックを配置できる全ての場所を試す
        for i in start_index..=latest_start {
            // ブロックを配置する（1で埋める）
            for j in 0..block_length {
                current_arrangement[i + j] = 1;
            }

            // 次のブロックを配置するために再帰呼び出し
            // 次のブロックは、現在のブロックの終わり+1マス空けた位置から開始できる
            let next_start = i + block_length + 1;
            recurse(
                size,
                rule,
                block_index + 1,
                next_start,
                current_arrangement,
                solutions,
            );

            // バックトラック：配置したブロックを元に戻し（0で埋める）、次の配置場所を試す
            for j in 0..block_length {
                current_arrangement[i + j] = 0;
            }
        }
    }

    // ルールが空または[0]の場合、すべて0のパターンのみが解となる
    if rule.is_empty() || (rule.len() == 1 && rule[0] == 0) {
        solutions.push(vec![0; size]);
    } else {
        // 再帰処理を開始
        recurse(size, rule, 0, 0, &mut current_arrangement, &mut solutions);
    }
    solutions
}

/// グリッド（2次元ベクトル）の行と列を入れ替える（転置する）ヘルパー関数
/// これにより、行を解析する`solve_line`関数を、列の解析にもそのまま再利用できる
fn transpose(grid: Vec<Vec<CellState>>) -> Vec<Vec<CellState>> {
    if grid.is_empty() {
        return Vec::new();
    }
    let rows = grid.len();
    let cols = grid[0].len();
    let mut transposed = vec![vec![CellState::Empty; rows]; cols];
    for r in 0..rows {
        for c in 0..cols {
            transposed[c][r] = grid[r][c];
        }
    }
    transposed
}

/// JavaScriptから呼び出されるメインの関数パズル全体の解析を行う
#[wasm_bindgen]
pub fn solve_puzzle(
    rows: usize,
    cols: usize,
    row_rules_js: JsValue,
    col_rules_js: JsValue,
    initial_grid_js: JsValue,
) -> Result<JsValue, JsValue> {
    // デバッグ用のパニックフックを設定
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    // 1. JavaScriptから渡されたJsValueを、Rustのデータ構造に変換（デシリアライズ）する
    let row_rules: Vec<Vec<usize>> = serde_wasm_bindgen::from_value(row_rules_js)?;
    let col_rules: Vec<Vec<usize>> = serde_wasm_bindgen::from_value(col_rules_js)?;
    let mut current_grid: Vec<Vec<CellState>> = serde_wasm_bindgen::from_value(initial_grid_js)?;

    // 呼び出し時点の盤面を、後で比較するために保存しておく
    let original_grid = current_grid.clone();
    // 無限ループを防ぐための最大反復回数を設定
    let max_iterations = (rows + cols) * 2;
    let mut iteration = 0;

    // 2. メインの解析ループ盤面に変化がなくなるまで繰り返す
    loop {
        let mut changed_in_this_iteration = false;

        // ステップA: 全ての行を解析する
        for r in 0..rows {
            match solve_line(cols, &row_rules[r], &current_grid[r]) {
                Ok(new_line) => {
                    // ラインに変化があれば、盤面を更新し、変更フラグを立てる
                    if new_line != current_grid[r] {
                        current_grid[r] = new_line;
                        changed_in_this_iteration = true;
                    }
                }
                // `solve_line`がエラーを返した場合、エラーメッセージを含んだ結果を返して即時終了
                Err(e) => {
                    let result = SolveResult {
                        grid: original_grid,
                        message: format!("行 {}: {}", r + 1, e),
                        error: true,
                    };
                    return Ok(serde_wasm_bindgen::to_value(&result)?);
                }
            }
        }

        // ステップB: 全ての列を解析する
        // グリッドを転置することで、`solve_line`を列解析に再利用する
        let mut transposed = transpose(current_grid.clone());
        for c in 0..cols {
            match solve_line(rows, &col_rules[c], &transposed[c]) {
                Ok(new_line) => {
                    if new_line != transposed[c] {
                        transposed[c] = new_line;
                        changed_in_this_iteration = true;
                    }
                }
                Err(e) => {
                    let result = SolveResult {
                        grid: original_grid,
                        message: format!("列 {}: {}", c + 1, e),
                        error: true,
                    };
                    return Ok(serde_wasm_bindgen::to_value(&result)?);
                }
            }
        }
        // 解析が終わったら、再度転置して盤面を元の向きに戻す
        current_grid = transpose(transposed);

        // 3. ループの終了条件をチェック
        iteration += 1;

        // このイテレーションで盤面に何も変化がなかった場合、解析は完了
        if !changed_in_this_iteration {
            let message = if current_grid == original_grid {
                // 呼び出し時点から何も変化がなければ、これ以上進展はない
                "これ以上自動で確定できるマスはありません".to_string()
            } else {
                // 呼び出し時点から変化していれば、更新があったことを伝える
                "確定できるマスを更新しました".to_string()
            };
            let result = SolveResult {
                grid: current_grid,
                message,
                error: false,
            };
            return Ok(serde_wasm_bindgen::to_value(&result)?);
        }

        // 最大反復回数に達した場合、エラーとして終了
        if iteration >= max_iterations {
            let result = SolveResult {
                grid: current_grid,
                message:
                    "反復回数が上限に達しましたロジックが複雑すぎるか、矛盾があるかもしれません"
                        .to_string(),
                error: true,
            };
            return Ok(serde_wasm_bindgen::to_value(&result)?);
        }
    }
}
