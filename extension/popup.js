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
          <div class="original-text-section">
            <div class="original-text-label">📝 元のテキスト</div>
            <div class="original-text-content">${escapeHtml(originalText)}</div>
          </div>

          <div class="loading-animation">
            <div class="spinner"></div>
            <p>Claudeが推敲中です。しばらくお待ちください...</p>
          </div>
        `;
        return;
      }

      // 結果表示
      const isError = proofreadResult && (proofreadResult.startsWith('エラー:') || proofreadResult.startsWith('サーバーとの通信に失敗'));

      // 日時フォーマット
      const date = new Date(timestamp);
      const formattedDate = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

      // 元のテキストセクション + チャット履歴
      contentDiv.innerHTML = `
        <div class="original-text-section">
          <div class="original-text-label">📝 元のテキスト</div>
          <div class="original-text-content">${escapeHtml(originalText)}</div>
        </div>

        ${renderAllMessages(messages, isError)}
      `;

      // 自動的に下にスクロール
      setTimeout(() => {
        contentDiv.scrollTop = contentDiv.scrollHeight;
      }, 50);

      // チャット入力エリアを表示
      const chatInputArea = document.getElementById('chatInputArea');
      const chatInput = document.getElementById('chatInput');
      const chatSendBtn = document.getElementById('chatSendBtn');

      if (!isError && messages && chatInputArea) {
        chatInputArea.style.display = 'block';

        // チャット送信ボタンのイベントリスナー
        if (chatInput && chatSendBtn) {
          const sendMessage = async () => {
            const message = chatInput.value.trim();
            if (!message) return;

            // 入力欄をクリア（即座に）
            chatInput.value = '';

            // ユーザーメッセージとローディング表示をすぐにストレージに追加（即座に表示）
            const updatedMessages = [...messages,
              { role: 'user', content: message },
              { role: 'assistant', content: '考え中...', isLoading: true }
            ];
            await chrome.storage.local.set({
              messages: updatedMessages,
              timestamp: Date.now()
            });

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
                // 成功時は何もしない（ストレージ更新で自動的にUIが更新される）
              } else {
                alert('エラー: ' + (response.error || '送信に失敗しました'));
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
      } else if (chatInputArea) {
        chatInputArea.style.display = 'none';
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

// 全メッセージを統一フォーマットでレンダリングする関数
function renderAllMessages(messages, isError) {
  if (isError) {
    return `<div class="chat-message assistant">
      <div class="chat-message-role">Claude</div>
      <div class="chat-message-bubble" style="background-color: #ffebee; color: #c62828;">
        ${escapeHtml(messages && messages[1] ? messages[1].content : 'エラーが発生しました')}
      </div>
    </div>`;
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '<p style="text-align: center; color: #999; padding: 40px;">会話履歴がありません</p>';
  }

  return messages.map((msg, index) => {
    // 最初のユーザーメッセージ（推敲依頼）はスキップ
    if (index === 0 && msg.role === 'user') {
      return '';
    }

    const roleLabel = msg.role === 'user' ? 'あなた' : 'Claude';

    // ローディング中の場合はスピナーを表示
    if (msg.isLoading) {
      return `
        <div class="chat-message ${msg.role}">
          <div class="chat-message-role">${roleLabel}</div>
          <div class="chat-message-bubble" style="display: flex; align-items: center; gap: 10px; padding: 12px 14px;">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; flex-shrink: 0;"></div>
            <span style="font-size: 13px; color: #666;">考え中...</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="chat-message ${msg.role}">
        <div class="chat-message-role">${roleLabel}</div>
        <div class="chat-message-bubble">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('');
}
