# AI推敲 Chrome拡張 by Claude

選択したテキストをローカルのClaude CLIを使って自動推敲するChrome拡張機能です。


https://github.com/user-attachments/assets/f59a0a0a-0bc3-4527-a207-aaef4466dde5


## 機能

- ブラウザ上のテキストを選択して右クリック
- 「AI推敲」メニューを選択
- ローカルサーバー経由でClaude CLIが推敲
- 結果をポップアップで表示

## 構成

```
chrome-extension-local-claude/
├── server/                 # ローカルサーバー
│   ├── package.json
│   └── server.js          # Express + Claude CLI統合
├── extension/             # Chrome拡張
│   ├── manifest.json
│   ├── background.js      # コンテキストメニュー制御
│   ├── popup.html         # 結果表示UI
│   ├── popup.js
│   └── icons/             # 拡張アイコン
└── README.md
```

## 必要な環境

- Node.js (v14以降)
- Claude CLI（インストール済みであること）
- Google Chrome

## セットアップ手順

### 1. Claude CLIのインストール確認

```bash
claude --version
```

Claude CLIがインストールされていない場合は、[公式ドキュメント](https://docs.anthropic.com/)を参照してインストールしてください。

### 2. サーバーのセットアップ

```bash
# プロジェクトディレクトリに移動
cd chrome-extension-local-claude

# サーバーディレクトリに移動
cd server

# 依存パッケージをインストール
npm install

# サーバーを起動
npm start
```

サーバーが `http://localhost:8080` で起動します。

### 3. Chrome拡張のインストール

1. Chromeを開く
2. アドレスバーに `chrome://extensions/` と入力
3. 右上の「デベロッパーモード」をONにする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. `extension`フォルダを選択

### 4. アイコンの準備（オプション）

`extension/icons/`ディレクトリに以下のアイコンファイルを配置してください：
- `icon16.png` (16x16px)
- `icon48.png` (48x48px)
- `icon128.png` (128x128px)

アイコンがなくても機能は動作しますが、見た目が改善されます。

## 使い方

1. ローカルサーバーを起動（`cd server && npm start`）
2. Webページ上で推敲したいテキストを選択
3. 右クリックして「AI推敲」を選択
4. ポップアップが開いて推敲結果が表示される
5. 「結果をコピー」ボタンで結果をクリップボードにコピー可能

## トラブルシューティング

### サーバーとの通信に失敗する

- サーバーが起動しているか確認: `http://localhost:8080/health` にアクセス
- ポート8080が他のプロセスで使用されていないか確認
- Chrome拡張の設定で `http://localhost:8080` へのアクセス許可が付与されているか確認

### Claude CLIが動作しない

```bash
# Claude CLIのパスを確認
which claude

# 手動でテストしてみる
echo "テスト" | claude --dangerously-skip-permissions
```

### 推敲結果が表示されない

- Chromeのデベロッパーツール（F12）を開いてエラーを確認
- 拡張機能の「バックグラウンドページ」のコンソールをチェック
- サーバーのターミナル出力を確認

## 開発

### サーバーの開発モード

```bash
cd server
npm run dev  # nodemonで自動リロード
```

### Chrome拡張の更新

1. コードを変更
2. `chrome://extensions/` で拡張機能の「更新」ボタンをクリック
3. Service Workerを再読み込み

## セキュリティに関する注意

- このツールは**ローカルネットワークのみ**で動作します
- `--dangerously-skip-permissions`フラグを使用しているため、Claude CLIは自動的に実行されます
- 機密情報を含むテキストの推敲には十分注意してください
- 本番環境での使用は推奨されません

## ライセンス

MIT License

## 今後の改善案

- [ ] 推敲スタイルの選択（丁寧、カジュアル、ビジネスなど）
- [ ] 推敲履歴の保存
- [ ] ダークモード対応
- [ ] キーボードショートカット
- [ ] 複数言語対応
- [ ] エラーハンドリングの改善
