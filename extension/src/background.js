import { CreateMLCEngine } from '@mlc-ai/web-llm';

// WebLLMエンジンのインスタンス
let engine = null;
let isInitializing = false;

// WebLLMエンジンを初期化
async function initializeEngine() {
  if (engine || isInitializing) return engine;
  
  isInitializing = true;
  try {
    console.log('[WebLLM] Initializing engine...');
    
    // 小さめのモデルを使用（ブラウザでの動作を考慮）
    // 利用可能なモデル: https://github.com/mlc-ai/web-llm#model-list
    engine = await CreateMLCEngine(
      "Llama-3.2-1B-Instruct-q4f16_1", // 1Bパラメータの軽量モデル
      {
        initProgressCallback: (progress) => {
          console.log('[WebLLM] Loading progress:', progress);
        }
      }
    );
    
    console.log('[WebLLM] Engine initialized successfully');
    return engine;
  } catch (error) {
    console.error('[WebLLM] Failed to initialize engine:', error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

// コンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-proofread',
    title: 'AI推敲',
    contexts: ['selection']
  });
  
  // エンジンを事前に初期化
  initializeEngine().catch(console.error);
});

// ページがリロードされたときにストレージをクリア
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

    // 即座にローディング状態を保存してポップアップを開く
    await chrome.storage.local.set({
      proofreadResult: null,
      originalText: selectedText,
      timestamp: Date.now(),
      isLoading: true
    });

    // ポップアップを即座に開く
    chrome.action.openPopup();

    // WebLLMで推敲を実行
    try {
      // エンジンを初期化
      const llm = await initializeEngine();
      
      // プロンプトを構築
      const prompt = `以下の文章を推敲してください。より読みやすく、わかりやすい文章に改善してください：

${selectedText}

改善された文章：`;

      // WebLLMに推敲を依頼
      const response = await llm.chat.completions.create({
        messages: [
          { 
            role: "system", 
            content: "あなたは優秀な文章校正者です。与えられた文章をより良く改善してください。"
          },
          { 
            role: "user", 
            content: prompt 
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      const result = response.choices[0].message.content;

      // 結果をメッセージ履歴として保存
      const messages = [
        { role: 'user', content: `以下の文章を推敲してください:\n${selectedText}` },
        { role: 'assistant', content: result }
      ];

      await chrome.storage.local.set({
        proofreadResult: result,
        originalText: selectedText,
        timestamp: Date.now(),
        isLoading: false,
        messages: messages
      });
    } catch (error) {
      console.error('Error with WebLLM:', error);
      await chrome.storage.local.set({
        proofreadResult: `エラー: ${error.message}`,
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

        // WebLLMでチャット応答を生成
        const llm = await initializeEngine();
        
        // 会話履歴を構築
        const chatMessages = [
          { 
            role: "system", 
            content: "あなたは優秀な文章校正者です。ユーザーの質問に答えたり、文章の改善を手伝ってください。"
          }
        ];
        
        // 最初に元のテキストのコンテキストを追加
        if (originalText) {
          chatMessages.push({
            role: "user",
            content: `元のテキスト: ${originalText}`
          });
        }
        
        // 会話履歴を追加
        messages.forEach((msg, index) => {
          if (index > 0 || msg.role !== 'user') { // 最初の推敲依頼はスキップ
            chatMessages.push({
              role: msg.role,
              content: msg.content
            });
          }
        });
        
        // 新しいユーザーメッセージを追加
        chatMessages.push({
          role: "user",
          content: message
        });

        const response = await llm.chat.completions.create({
          messages: chatMessages,
          temperature: 0.7,
          max_tokens: 1000
        });

        const result = response.choices[0].message.content;

        // ストレージから最新のメッセージ配列を取得
        const storageData = await chrome.storage.local.get(['messages']);
        const currentMessages = storageData.messages || [];

        // ローディングメッセージを除外して、実際のレスポンスを追加
        const finalMessages = currentMessages.filter(msg => !msg.isLoading);
        finalMessages.push({ role: 'assistant', content: result });

        // ストレージを更新
        await chrome.storage.local.set({
          messages: finalMessages,
          timestamp: Date.now()
        });

        sendResponse({ success: true, result: result });
      } catch (error) {
        console.error('Error sending chat message:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 非同期レスポンスを示す
  }
  
  // エンジンの初期化状態を確認
  if (request.action === 'checkEngineStatus') {
    sendResponse({ 
      initialized: !!engine,
      initializing: isInitializing 
    });
    return false;
  }
});