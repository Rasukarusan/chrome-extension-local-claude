import { ExtensionServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Service Worker ハンドラー
let handler;
let currentPort = null;

// ポート接続のリスナー
chrome.runtime.onConnect.addListener((port) => {
  console.log("[WebLLM] Port connected:", port.name);
  
  if (port.name === "web_llm_service_worker") {
    currentPort = port;
    
    if (!handler) {
      console.log("[WebLLM] Creating new handler");
      handler = new ExtensionServiceWorkerMLCEngineHandler(port);
    } else {
      console.log("[WebLLM] Updating existing handler with new port");
      handler.setPort(port);
    }
    
    port.onMessage.addListener((msg) => {
      console.log("[WebLLM] Message received:", msg);
      handler.onmessage(msg);
    });
    
    port.onDisconnect.addListener(() => {
      console.log("[WebLLM] Port disconnected");
      currentPort = null;
    });
  }
});

// コンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ai-proofread",
    title: "AI推敲",
    contexts: ["selection"],
  });

  // Service Workerの準備完了をログ
  console.log("[WebLLM] Service Worker ready for connections");
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

    // ポップアップからの推敲リクエストをストレージに保存
    // ポップアップ側がWebLLMエンジンを使って処理を実行する
    console.log("[WebLLM] Context menu clicked, saving request to storage");
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

  // チャットメッセージはポップアップ側で直接処理するため、ここでは処理しない
});