// ポップアップが開かれた時に結果を表示
document.addEventListener('DOMContentLoaded', async () => {
  const contentDiv = document.getElementById('content');

  // 初回読み込み
  await updateDisplay();

  // ストレージの変更を監視してリアルタイム更新
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      updateDisplay();
    }
  });

  async function updateDisplay() {
    try {
      // ストレージから直接データを取得
      const data = await chrome.storage.local.get(['proofreadResult', 'originalText', 'timestamp', 'isLoading']);

      // データがない場合
      if (!data.originalText) {
        contentDiv.innerHTML = `
          <div class="no-result">
            <p>推敲結果がありません。</p>
            <p>テキストを選択して右クリックから「AI推敲」を選択してください。</p>
          </div>
        `;
        return;
      }

      const { proofreadResult, originalText, timestamp, isLoading } = data;

      // ローディング中の表示
      if (isLoading) {
        contentDiv.innerHTML = `
          <div class="section">
            <div class="section-title">元のテキスト:</div>
            <div class="original-text">${escapeHtml(originalText)}</div>
          </div>

          <div class="section">
            <div class="section-title">推敲中...</div>
            <div class="loading-animation">
              <div class="spinner"></div>
              <p>Claudeが推敲中です。しばらくお待ちください...</p>
            </div>
          </div>
        `;
        return;
      }

      // 結果表示
      const isError = proofreadResult && (proofreadResult.startsWith('エラー:') || proofreadResult.startsWith('サーバーとの通信に失敗'));

      // 日時フォーマット
      const date = new Date(timestamp);
      const formattedDate = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

      contentDiv.innerHTML = `
        <div class="section">
          <div class="section-title">元のテキスト:</div>
          <div class="original-text">${escapeHtml(originalText)}</div>
        </div>

        <div class="section">
          <div class="section-title">推敲結果:</div>
          <div class="result-text ${isError ? 'error' : ''}">${escapeHtml(proofreadResult)}</div>
          ${!isError ? '<button class="copy-btn" id="copyBtn">結果をコピー</button>' : ''}
        </div>

        <div class="timestamp">取得日時: ${formattedDate}</div>
      `;

      // コピーボタンのイベントリスナー
      if (!isError) {
        document.getElementById('copyBtn').addEventListener('click', () => {
          navigator.clipboard.writeText(proofreadResult).then(() => {
            const btn = document.getElementById('copyBtn');
            btn.textContent = 'コピーしました!';
            setTimeout(() => {
              btn.textContent = '結果をコピー';
            }, 2000);
          }).catch(err => {
            console.error('Failed to copy:', err);
            alert('コピーに失敗しました');
          });
        });
      }
    } catch (error) {
      console.error('Error loading result:', error);
      contentDiv.innerHTML = `
        <div class="no-result">
          <p>結果の読み込みに失敗しました。</p>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
});

// HTMLエスケープ関数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
