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
      const data = await chrome.storage.local.get(['proofreadResult', 'originalText', 'timestamp', 'isLoading', 'messages']);

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

      const {proofreadResult, originalText, timestamp, isLoading, messages} = data;

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
        </div>

        ${!isError && messages ? `
          <div class="chat-section">
            <div class="chat-messages" id="chatMessages">
              ${renderChatMessages(messages)}
            </div>
            <div class="chat-input-container">
              <input type="text" class="chat-input" id="chatInput" placeholder="例: もっと短くして、もっと丁寧に、など...">
              <button class="chat-send-btn" id="chatSendBtn">送信</button>
            </div>
          </div>
        ` : ''}

        <div class="timestamp">取得日時: ${formattedDate}</div>
      `;

      // チャット送信ボタンのイベントリスナー
      if (!isError) {
        const chatSendBtn = document.getElementById('chatSendBtn');
        const chatInput = document.getElementById('chatInput');
        if (chatSendBtn && chatInput) {
          const sendMessage = async () => {
            const message = chatInput.value.trim();
            if (!message) return;

            // ボタンを無効化
            chatSendBtn.disabled = true;
            chatInput.disabled = true;
            chatSendBtn.textContent = '送信中...';

            try {
              const response = await chrome.runtime.sendMessage({
                action: 'sendChatMessage',
                message: message,
                messages: messages,
                originalText: originalText
              });

              if (response.success) {
                // 入力欄をクリア
                chatInput.value = '';
              } else {
                alert('エラー: ' + response.error);
              }
            } catch (error) {
              console.error('Failed to send message:', error);
              alert('メッセージの送信に失敗しました');
            } finally {
              chatSendBtn.disabled = false;
              chatInput.disabled = false;
              chatSendBtn.textContent = '送信';
            }
          };

          chatSendBtn.addEventListener('click', sendMessage);
          chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              sendMessage();
            }
          });
        }
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

// チャットメッセージをレンダリングする関数
function renderChatMessages(messages) {
  if (!messages || messages.length === 0) {
    return '<p style="text-align: center; color: #999;">会話履歴がありません</p>';
  }

  return messages.map((msg, index) => {
    // 最初のユーザーメッセージ（推敲依頼）はスキップ
    if (index === 0 && msg.role === 'user') {
      return '';
    }
    // 最初のアシスタントメッセージ（推敲結果）もスキップ（上部に表示済み）
    if (index === 1 && msg.role === 'assistant') {
      return '';
    }

    const roleLabel = msg.role === 'user' ? 'あなた' : 'Claude';
    return `
      <div class="chat-message ${msg.role}">
        <div class="chat-message-role">${roleLabel}</div>
        <div class="chat-message-content">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('');
}
