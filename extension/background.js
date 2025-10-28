// コンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-proofread',
    title: 'AI推敲',
    contexts: ['selection']
  });
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
        // 結果をストレージに保存（ポップアップが自動更新される）
        await chrome.storage.local.set({
          proofreadResult: data.result,
          originalText: selectedText,
          timestamp: Date.now(),
          isLoading: false
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
});
