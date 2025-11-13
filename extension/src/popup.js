import {
  CreateExtensionServiceWorkerMLCEngine,
  MLCEngineInterface,
  ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";

// WebLLMエンジンのインスタンス
let engine = null;
let isInitializing = false;

// WebLLMエンジンを初期化（Service Worker経由）
async function initializeEngine() {
  if (engine || isInitializing) return engine;

  isInitializing = true;
  try {
    console.log("[WebLLM] Initializing engine via Service Worker...");

    // Service Worker経由でエンジンを作成
    engine = await CreateExtensionServiceWorkerMLCEngine("gemma-2-2b-jpn-it", {
      initProgressCallback: (progress) => {
        console.log("[WebLLM] Loading progress:", progress);
        // プログレスバーを更新
        updateProgressBar(progress);
      },
    });

    console.log("[WebLLM] Engine initialized successfully");
    return engine;
  } catch (error) {
    console.error("[WebLLM] Failed to initialize engine:", error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

// プログレスバーを更新
function updateProgressBar(progress) {
  const contentDiv = document.getElementById("content");
  if (!contentDiv) return;

  const progressInfo = `${Math.round(progress.progress * 100)}% - ${progress.text || "Loading..."}`;
  const progressBar = contentDiv.querySelector(".progress-info");
  if (progressBar) {
    progressBar.textContent = progressInfo;
  }
}

// ポップアップが開かれた時に結果を表示
document.addEventListener("DOMContentLoaded", async () => {
  const contentDiv = document.getElementById("content");

  // 初回読み込み
  await updateDisplay();

  // ストレージの変更を監視してリアルタイム更新
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      updateDisplay();
    }
  });

  async function updateDisplay() {
    try {
      // ストレージから直接データを取得
      const data = await chrome.storage.local.get([
        "proofreadResult",
        "originalText",
        "timestamp",
        "isLoading",
        "messages",
      ]);

      // データがない場合
      if (!data.originalText) {
        contentDiv.innerHTML = `
          <div class="no-result">
            <p>推敲結果がありません。</p>
            <p>テキストを選択して右クリックから「AI推敲」を選択してください。</p>
            <p class="model-info">🤖 WebLLM (Qwen2.5-1.5B) で動作中</p>
          </div>
        `;
        return;
      }

      const { proofreadResult, originalText, timestamp, isLoading, messages } =
        data;

      // ローディング中でまだ推敲が開始されていない場合
      if (isLoading && !messages) {
        // WebLLMで推敲を実行
        executeProofreading(originalText);

        contentDiv.innerHTML = `
          <div class="original-text-section">
            <div class="original-text-label">📝 元のテキスト</div>
            <div class="original-text-content">${escapeHtml(originalText)}</div>
          </div>

          <div class="loading-animation">
            <div class="spinner"></div>
            <p>AI（WebLLM）が推敲中です。しばらくお待ちください...</p>
            <p class="loading-note">初回はモデルの読み込みに時間がかかります</p>
            <p class="progress-info"></p>
          </div>
        `;
        return;
      }

      // 結果表示
      const isError = proofreadResult && proofreadResult.startsWith("エラー:");

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
      const chatInputArea = document.getElementById("chatInputArea");
      const chatInput = document.getElementById("chatInput");
      const chatSendBtn = document.getElementById("chatSendBtn");

      if (!isError && messages && chatInputArea) {
        chatInputArea.style.display = "block";

        // チャット送信ボタンのイベントリスナー
        if (chatInput && chatSendBtn) {
          const sendMessage = async () => {
            const message = chatInput.value.trim();
            if (!message) return;

            // 入力欄をクリア（即座に）
            chatInput.value = "";

            // ユーザーメッセージとローディング表示をすぐにストレージに追加（即座に表示）
            const updatedMessages = [
              ...messages,
              { role: "user", content: message },
              { role: "assistant", content: "", isLoading: true },
            ];
            await chrome.storage.local.set({
              messages: updatedMessages,
              timestamp: Date.now(),
            });

            // ボタンを無効化
            chatSendBtn.disabled = true;
            chatInput.disabled = true;
            chatSendBtn.textContent = "送信中...";

            try {
              // WebLLMでチャット応答を生成
              await executeChatResponse(message, messages, originalText);
            } catch (error) {
              console.error("Failed to send message:", error);
              alert("メッセージの送信に失敗しました: " + error.message);
            } finally {
              chatSendBtn.disabled = false;
              chatInput.disabled = false;
              chatSendBtn.textContent = "送信";
            }
          };

          chatSendBtn.addEventListener("click", sendMessage);
          chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
              sendMessage();
            }
          });
        }
      } else if (chatInputArea) {
        chatInputArea.style.display = "none";
      }
    } catch (error) {
      console.error("Error loading result:", error);
      contentDiv.innerHTML = `
        <div class="no-result">
          <p>結果の読み込みに失敗しました。</p>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  }
});

// 推敲を実行
async function executeProofreading(selectedText) {
  try {
    // エンジンを初期化
    const llm = await initializeEngine();

    // プロンプトを構築
    const prompt = `以下の文章を推敲してください。修正点の列挙は不要です。出力例のように出力してください。
出力例：
【フォーマル】
XXXXXXXXXX
【カジュアル】
YYYYYYYYYY
【簡潔】
ZZZZZZZZZ

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
      stream: true,
    });

    // ストリーミングレスポンスを処理
    let result = "";

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content || "";
      result += delta;

      // リアルタイムで結果を更新
      const messages = [
        {
          role: "user",
          content: `以下の文章を推敲してください:\n${selectedText}`,
        },
        { role: "assistant", content: result },
      ];

      await chrome.storage.local.set({
        proofreadResult: result,
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

// チャット応答を実行
async function executeChatResponse(message, messages, originalText) {
  try {
    // エンジンを初期化
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
      stream: true,
    });

    // ストリーミング開始前にユーザーメッセージを正式に追加
    const baseMessages = [...messages, { role: "user", content: message }];

    // ストリーミングレスポンスを処理
    let result = "";

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content || "";
      result += delta;

      // アシスタントの応答を含めたメッセージ配列を構築
      const finalMessages = [
        ...baseMessages,
        { role: "assistant", content: result },
      ];

      // ストレージを更新
      await chrome.storage.local.set({
        messages: finalMessages,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error("Error sending chat message:", error);
    throw error;
  }
}

// HTMLエスケープ関数
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 全メッセージを統一フォーマットでレンダリングする関数
function renderAllMessages(messages, isError) {
  if (isError) {
    return `<div class="chat-message assistant">
      <div class="chat-message-role">AI (WebLLM)</div>
      <div class="chat-message-bubble" style="background-color: #ffebee; color: #c62828;">
        ${escapeHtml(messages && messages[1] ? messages[1].content : "エラーが発生しました")}
      </div>
    </div>`;
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return '<p style="text-align: center; color: #999; padding: 40px;">会話履歴がありません</p>';
  }

  return messages
    .map((msg, index) => {
      // 最初のユーザーメッセージ（推敲依頼）はスキップ
      if (index === 0 && msg.role === "user") {
        return "";
      }

      const roleLabel = msg.role === "user" ? "あなた" : "AI (WebLLM)";

      // ローディング中の場合はスピナーを表示
      if (msg.isLoading) {
        return `
        <div class="chat-message ${msg.role}">
          <div class="chat-message-role">${roleLabel}</div>
          <div class="chat-message-bubble" style="display: flex; align-items: center; gap: 10px; padding: 12px 14px;">
            ${
              msg.content
                ? `<span style="font-size: 14px;">${escapeHtml(msg.content)}</span>`
                : `<div class="spinner" style="width: 20px; height: 20px; border-width: 2px; flex-shrink: 0;"></div>
               <span style="font-size: 13px; color: #666;">考え中...</span>`
            }
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
    })
    .join("");
}