import { CreateMLCEngine } from "@mlc-ai/web-llm";

// WebLLMエンジンのインスタンス
let engine = null;
let isInitializing = false;

// thinkタグを削除するヘルパー関数
function removeThinkTags(text) {
  // <think>...</think>タグを削除（改行含む、ネストも考慮）
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// WebLLMエンジンを初期化
async function initializeEngine() {
  if (engine || isInitializing) return engine;

  isInitializing = true;
  try {
    console.log("[WebLLM] Initializing engine...");

    // 小さめのモデルを使用（ブラウザでの動作を考慮）
    // 利用可能なモデル: https://mlc.ai/models
    engine = await CreateMLCEngine(
      // 4GBぐらいあるので初回ロード時は時間がかかる
      "Qwen3-8B-q4f16_1-MLC",
      {
        initProgressCallback: (progress) => {
          console.log("[WebLLM] Loading progress:", progress);
        },
      },
    );

    console.log("[WebLLM] Engine initialized successfully");
    return engine;
  } catch (error) {
    console.error("[WebLLM] Failed to initialize engine:", error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

// コンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ai-proofread",
    title: "AI推敲",
    contexts: ["selection"],
  });

  // エンジンを事前に初期化
  initializeEngine().catch(console.error);
});

// ページがリロードされたときにストレージをクリア
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    chrome.storage.local.clear();
    console.log("[BACKGROUND] Page reloaded, storage cleared");
  }
});

// コンテキストメニューがクリックされた時の処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ai-proofread") {
    const selectedText = info.selectionText;

    if (!selectedText) {
      console.error("No text selected");
      return;
    }

    // 即座にローディング状態を保存してポップアップを開く
    await chrome.storage.local.set({
      proofreadResult: null,
      originalText: selectedText,
      timestamp: Date.now(),
      isLoading: true,
    });

    // ポップアップを即座に開く
    chrome.action.openPopup();

    // WebLLMで推敲を実行
    try {
      // エンジンを初期化
      const llm = await initializeEngine();

      // プロンプトを構築
      const prompt = `/no_think。以下の文章を推敲してください。修正点の列挙は不要です。出力は【フォーマル】【カジュアル】【簡潔】の3パターンを日本語で出力してください。
出力例：
【フォーマル】
xxxxxxx
【カジュアル】
yyyyyyy
【簡潔】
zzzzzzz
文章:
${selectedText}`;

      // WebLLMに推敲を依頼（ストリーミング）
      const response = await llm.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "あなたは優秀な文章校正者です。与えられた文章を【フォーマル】【カジュアル】【簡潔】の3つのパターンで推敲してください。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        stream: true, // ストリーミングを有効化
      });

      // ストリーミングレスポンスを処理
      let result = "";

      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta?.content || "";
        result += delta;

        // thinkタグを削除してクリーンな結果を取得
        const cleanResult = removeThinkTags(result);

        // リアルタイムで結果を更新
        const messages = [
          {
            role: "user",
            content: `以下の文章を推敲してください:\n${selectedText}`,
          },
          { role: "assistant", content: cleanResult },
        ];

        await chrome.storage.local.set({
          proofreadResult: cleanResult,
          originalText: selectedText,
          timestamp: Date.now(),
          isLoading: false,
          messages: messages,
        });
      }
    } catch (error) {
      console.error("Error with WebLLM:", error);
      await chrome.storage.local.set({
        proofreadResult: `エラー: ${error.message}`,
        originalText: selectedText,
        timestamp: Date.now(),
        isLoading: false,
      });
    }
  }
});

// ストレージから結果を取得するメッセージハンドラ
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getProofreadResult") {
    chrome.storage.local.get(
      ["proofreadResult", "originalText", "timestamp"],
      (data) => {
        sendResponse(data);
      },
    );
    return true; // 非同期レスポンスを示す
  }

  // チャットメッセージ送信ハンドラ
  if (request.action === "sendChatMessage") {
    (async () => {
      try {
        const { message, messages, originalText } = request;

        // 新しいメッセージを履歴に追加
        const updatedMessages = [
          ...messages,
          { role: "user", content: message },
        ];

        // WebLLMでチャット応答を生成
        const llm = await initializeEngine();

        // 会話履歴を構築
        const chatMessages = [
          {
            role: "system",
            content:
              "あなたは優秀な文章校正者です。ユーザーの質問に答えたり、文章の改善を手伝ってください。",
          },
        ];

        // 最初に元のテキストのコンテキストを追加
        if (originalText) {
          chatMessages.push({
            role: "user",
            content: `元のテキスト: ${originalText}`,
          });
        }

        // 会話履歴を追加
        messages.forEach((msg, index) => {
          if (index > 0 || msg.role !== "user") {
            // 最初の推敲依頼はスキップ
            chatMessages.push({
              role: msg.role,
              content: msg.content,
            });
          }
        });

        // 新しいユーザーメッセージを追加
        chatMessages.push({
          role: "user",
          content: message,
        });

        const response = await llm.chat.completions.create({
          messages: chatMessages,
          temperature: 0.7,
          max_tokens: 1000,
          stream: true, // ストリーミングを有効化
        });

        // ストリーミング開始前にユーザーメッセージを正式に追加
        const baseMessages = [...messages, { role: "user", content: message }];

        // ストリーミングレスポンスを処理
        let result = "";

        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta?.content || "";
          result += delta;

          // thinkタグを削除してクリーンな結果を取得
          const cleanResult = removeThinkTags(result);

          // アシスタントの応答を含めたメッセージ配列を構築
          const finalMessages = [
            ...baseMessages,
            { role: "assistant", content: cleanResult },
          ];

          // ストレージを更新
          await chrome.storage.local.set({
            messages: finalMessages,
            timestamp: Date.now(),
          });
        }

        sendResponse({ success: true, result: cleanResult });
      } catch (error) {
        console.error("Error sending chat message:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 非同期レスポンスを示す
  }

  // エンジンの初期化状態を確認
  if (request.action === "checkEngineStatus") {
    sendResponse({
      initialized: !!engine,
      initializing: isInitializing,
    });
    return false;
  }
});
