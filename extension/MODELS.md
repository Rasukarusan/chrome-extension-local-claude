# WebLLM 利用可能モデル一覧

## 推奨モデル（軽量・高速）

1. **TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC**
   - サイズ: 約500MB
   - 最も軽量で高速
   - 基本的な推敲には十分

2. **Llama-3.2-3B-Instruct**
   - サイズ: 約2GB
   - バランスの良い性能

3. **Phi-3.5-mini-instruct-q4f16_1-MLC**
   - サイズ: 約2GB
   - Microsoft製の高性能モデル

## モデルの変更方法

`src/background.js`の17行目を編集：

```javascript
engine = await CreateMLCEngine(
  "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", // ← ここを変更
  {
    initProgressCallback: (progress) => {
      console.log('[WebLLM] Loading progress:', progress);
    }
  }
);
```

変更後は必ず再ビルド：
```bash
npm run build
```

## トラブルシューティング

モデルが見つからないエラーが出る場合は、TinyLlamaを試してください。
これは最も安定して動作するモデルです。