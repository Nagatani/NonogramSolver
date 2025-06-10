import itertools
from functools import lru_cache
import copy

class NonogramSolverWithBacktracking:
    """
    お絵かきロジック（ピクロス）を解くためのソルバークラス。
    基本的な論理的推論に加え、バックトラッキング法を用いて
    より困難なパズルにも対応します。
    """

    UNKNOWN = 0
    FILLED = 1
    BLANK = -1

    def __init__(self, row_hints, col_hints, verbose=True):
        """
        ソルバーを初期化します。

        Args:
            row_hints (list[list[int]]): 各行のヒント。
            col_hints (list[list[int]]): 各列のヒント。
            verbose (bool): 解決過程を詳細に出力するかどうか。
        """
        self.row_hints = row_hints
        self.col_hints = col_hints
        self.height = len(row_hints)
        self.width = len(col_hints)
        self.board = [[self.UNKNOWN for _ in range(self.width)] for _ in range(self.height)]
        self.verbose = verbose
        if self.verbose:
            print("--- 初期盤面 ---")
            self.print_board()

    def print_board(self, board_state=None):
        """現在の盤面状態をコンソールに整形して出力します。"""
        board = board_state if board_state is not None else self.board
        # 盤面の表示ロジックは変更なし (可読性のため省略)
        max_row_hint_len_str = max(len(' '.join(map(str, h))) for h in self.row_hints) if self.row_hints else 0
        max_col_hint_len = max(len(h) for h in self.col_hints) if self.col_hints else 0
        
        for i in range(max_col_hint_len):
            print(" " * (max_row_hint_len_str + 2), end="")
            for j in range(self.width):
                if i < max_col_hint_len - len(self.col_hints[j]):
                    print("  ", end="")
                else:
                    hint_idx = i - (max_col_hint_len - len(self.col_hints[j]))
                    print(f"{self.col_hints[j][hint_idx]:>2}", end="")
            print()
            
        print("-" * (self.width * 2 + max_row_hint_len_str + 2))

        for i in range(self.height):
            hint_str = ' '.join(map(str, self.row_hints[i]))
            print(f"{hint_str:<{max_row_hint_len_str}} | ", end="")
            for j in range(self.width):
                cell = board[i][j]
                if cell == self.FILLED: print("■ ", end="")
                elif cell == self.BLANK: print(". ", end="")
                else: print("? ", end="")
            print()
        print("-" * (self.width * 2 + max_row_hint_len_str + 2))
        print()


    @staticmethod
    @lru_cache(maxsize=None)
    def _get_line_possibilities(hints, length):
        """与えられたヒントと長さに適合する全ての可能なラインパターンを生成します。"""
        # この関数のロジックは変更なし
        if not hints:
            return [[NonogramSolverWithBacktracking.BLANK] * length]
        min_length = sum(hints) + len(hints) - 1
        slack = length - min_length
        if slack < 0: return []
        
        num_slots = len(hints) + 1
        possibilities = []
        for slack_distribution in itertools.combinations_with_replacement(range(num_slots), slack):
            slots = [0] * num_slots
            for slot_index in slack_distribution:
                slots[slot_index] += 1
            line = []
            line.extend([NonogramSolverWithBacktracking.BLANK] * slots[0])
            for i, hint in enumerate(hints):
                line.extend([NonogramSolverWithBacktracking.FILLED] * hint)
                if i < len(hints) - 1:
                    line.append(NonogramSolverWithBacktracking.BLANK)
                    line.extend([NonogramSolverWithBacktracking.BLANK] * slots[i + 1])
            line.extend([NonogramSolverWithBacktracking.BLANK] * slots[-1])
            possibilities.append(line)
        return possibilities

    def _apply_logic_iteration(self, board):
        """
        現在の盤面に対して論理的推論を1サイクル適用し、盤面を更新します。
        
        Returns:
            bool: 盤面に変更があったかどうか。
        """
        changed_in_iteration = False
        # 1. 行の処理
        for i in range(self.height):
            current_line = board[i]
            hints = tuple(self.row_hints[i])
            all_possibilities = self._get_line_possibilities(hints, self.width)
            
            valid_possibilities = [p for p in all_possibilities if all(current_line[j] in (self.UNKNOWN, p[j]) for j in range(self.width))]

            if not valid_possibilities: return None # 矛盾が発生

            for j in range(self.width):
                if current_line[j] == self.UNKNOWN:
                    first_val = valid_possibilities[0][j]
                    if all(p[j] == first_val for p in valid_possibilities):
                        board[i][j] = first_val
                        changed_in_iteration = True
        
        # 2. 列の処理
        for j in range(self.width):
            current_line = [board[i][j] for i in range(self.height)]
            hints = tuple(self.col_hints[j])
            all_possibilities = self._get_line_possibilities(hints, self.height)

            valid_possibilities = [p for p in all_possibilities if all(current_line[i] in (self.UNKNOWN, p[i]) for i in range(self.height))]

            if not valid_possibilities: return None # 矛盾が発生

            for i in range(self.height):
                if current_line[i] == self.UNKNOWN:
                    first_val = valid_possibilities[0][i]
                    if all(p[i] == first_val for p in valid_possibilities):
                        if board[i][j] != first_val:
                            board[i][j] = first_val
                            changed_in_iteration = True
        
        return changed_in_iteration

    def _solve_recursive(self, current_board):
        """再帰的にバックトラッキングを用いてパズルを解きます。"""
        
        # 1. 論理的推論で盤面をできるだけ進める
        while True:
            result = self._apply_logic_iteration(current_board)
            if result is None: # 矛盾が見つかった
                if self.verbose: print("... この仮定は矛盾に繋がりました。バックトラックします。")
                return None
            if not result: # 変更がなくなった
                break
        
        # 2. 解決したかチェック
        first_unknown = None
        for r_idx, row in enumerate(current_board):
            for c_idx, cell in enumerate(row):
                if cell == self.UNKNOWN:
                    first_unknown = (r_idx, c_idx)
                    break
            if first_unknown:
                break
        
        if not first_unknown:
            if self.verbose: print("盤面が完成しました！")
            return current_board # 完成

        # 3. 手詰まりなので、推測（バックトラッキング）を行う
        r, c = first_unknown
        if self.verbose: print(f"手詰まりです。({r}, {c}) で推測を開始します。")

        # 3a. 黒マス(FILLED)と仮定してみる
        if self.verbose: print(f"  -> ({r}, {c}) を ■ と仮定...")
        board_copy = copy.deepcopy(current_board)
        board_copy[r][c] = self.FILLED
        solution = self._solve_recursive(board_copy)
        if solution:
            return solution

        # 3b. 黒マスの仮定が失敗したので、白マス(BLANK)と仮定してみる
        if self.verbose: print(f"  -> ({r}, {c}) を . と仮定...")
        current_board[r][c] = self.BLANK # 元の盤面で試す
        solution = self._solve_recursive(current_board)
        if solution:
            return solution
        
        return None # どちらの仮定も解に繋がらなかった

    def solve(self):
        """パズルを解くためのエントリーポイント。"""
        solution_board = self._solve_recursive(copy.deepcopy(self.board))
        
        print("--- 最終結果 ---")
        if solution_board:
            self.board = solution_board
            self.print_board()
            print("成功: パズルが完全に解決されました！")
        else:
            self.print_board()
            print("失敗: このパズルの解を見つけることができませんでした。")

def run_test_case(name, row_hints, col_hints, verbose=True):
    print(f"==========================================")
    print(f"テストケース: {name}")
    print(f"==========================================")
    
    solver = NonogramSolverWithBacktracking(row_hints, col_hints, verbose)
    solver.solve()
    print("\n\n")

# --- メインのテストコード ---
if __name__ == "__main__":
    # テストケース1: 簡単なハート (論理だけで解けるはず)
    heart_row_hints = [[1, 1], [5], [5], [3], [1]]
    heart_col_hints = [[2], [4], [5], [4], [2]]
    run_test_case("5x5 ハート (論理テスト)", heart_row_hints, heart_col_hints)
    
    # テストケース2: バックトラッキングが必要な問題
    # 論理だけでは初期状態で手詰まりになる
    # 解:
    # ■ . ■
    # . ■ .
    # ■ . ■
    tricky_row_hints = [[1, 1], [1], [1, 1]]
    tricky_col_hints = [[1, 1], [1], [1, 1]]
    run_test_case("3x3 バックトラッキング必須問題", tricky_row_hints, tricky_col_hints)
    
    # テストケース3: より複雑なバックトラッキング問題 (Webで見つけた例)
    # 解:
    # . ■ ■ . .
    # ■ . . ■ .
    # ■ ■ ■ ■ .
    # ■ . . ■ .
    # . ■ ■ . .
    complex_bt_row = [[2], [1, 1], [4], [1, 1], [2]]
    complex_bt_col = [[2, 1], [1, 1], [1, 1], [3], []]
    run_test_case("5x5 複雑なバックトラッキング問題", complex_bt_row, complex_bt_col)

