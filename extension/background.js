// コンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-proofread',
    title: 'AI推敲',
    contexts: ['selection']
  });
});

// ページがリロードされたときにストレージをクリア
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ページのリロードが完了したとき（status: 'loading' → 'complete'）
  if (changeInfo.status === 'loading') {
    chrome.storage.local.clear();
    console.log('[BACKGROUND] Page reloaded, storage cleared');
  }
});

// コンテキストメニューがクリックされた時の処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ai-proofread') {
    const selectedText = info.selectionText;

    if (!selectedText) {
      console.error('No text selected');
      return;
    }

    // ✨ 即座にローディング状態を保存してポップアップを開く
    await chrome.storage.local.set({
      proofreadResult: null,
      originalText: selectedText,
      timestamp: Date.now(),
      isLoading: true
    });

    // ポップアップを即座に開く
    chrome.action.openPopup();

    // バックグラウンドでサーバーにリクエスト
    try {
      const response = await fetch('http://localhost:8080/proofread', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: selectedText })
      });

      const data = await response.json();

      if (data.success) {
        // 結果をメッセージ履歴として保存（ポップアップが自動更新される）
        const messages = [
          { role: 'user', content: `以下の文章を推敲してください:\n${selectedText}` },
          { role: 'assistant', content: data.result }
        ];

        await chrome.storage.local.set({
          proofreadResult: data.result,
          originalText: selectedText,
          timestamp: Date.now(),
          isLoading: false,
          messages: messages
        });
      } else {
        console.error('Proofread failed:', data.error);
        await chrome.storage.local.set({
          proofreadResult: `エラー: ${data.error}`,
          originalText: selectedText,
          timestamp: Date.now(),
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Error communicating with server:', error);
      await chrome.storage.local.set({
        proofreadResult: `サーバーとの通信に失敗しました。ローカルサーバーが起動しているか確認してください。\n\nエラー: ${error.message}`,
        originalText: selectedText,
        timestamp: Date.now(),
        isLoading: false
      });
    }
  }
});

// ストレージから結果を取得するメッセージハンドラ
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProofreadResult') {
    chrome.storage.local.get(['proofreadResult', 'originalText', 'timestamp'], (data) => {
      sendResponse(data);
    });
    return true; // 非同期レスポンスを示す
  }

  // チャットメッセージ送信ハンドラ
  if (request.action === 'sendChatMessage') {
    (async () => {
      try {
        const { message, messages, originalText } = request;

        // 新しいメッセージを履歴に追加
        const updatedMessages = [...messages, { role: 'user', content: message }];

        // サーバーにリクエスト
        const response = await fetch('http://localhost:8080/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messages: updatedMessages,
            originalText: originalText
          })
        });

        const data = await response.json();

        if (data.success) {
          // アシスタントの返答を履歴に追加
          updatedMessages.push({ role: 'assistant', content: data.result });

          // ストレージを更新
          await chrome.storage.local.set({
            messages: updatedMessages,
            timestamp: Date.now()
          });

          sendResponse({ success: true, result: data.result });
        } else {
          sendResponse({ success: false, error: data.error });
        }
      } catch (error) {
        console.error('Error sending chat message:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 非同期レスポンスを示す
  }
});
