const express = require('express');
const cors = require('cors');
const {exec} = require('child_process');
const {promisify} = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);
const app = express();
const PORT = 8080;

// CORS設定（Chrome拡張からのアクセスを許可）
app.use(cors());
app.use(express.json());

// 一時ファイルを使ってClaudeと対話する関数
async function proofreadWithClaude(text) {
  const tmpDir = os.tmpdir();
  const inputFile = path.join(tmpDir, `claude-input-${Date.now()}.txt`);

  try {
    // プロンプトを作成
    const prompt = `以下の文章を推敲してください。修正点の列挙は不要です。出力は用途別に3パターンを出力してください。いきなり本題から入ってください。markdownではなくtextで出力してください。
文章:
${text}`;

    // 一時ファイルにプロンプトを書き込み
    await fs.writeFile(inputFile, prompt, 'utf-8');

    // Claude CLIを実行（標準入力からプロンプトを渡す）
    const command = `cat "${inputFile}" | claude`;

    console.log('Executing Claude CLI...');
    const {stdout, stderr} = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB
      timeout: 60000 // 60秒タイムアウト
    });

    if (stderr) {
      console.error('Claude CLI stderr:', stderr);
    }

    // 一時ファイルを削除
    await fs.unlink(inputFile).catch(() => {});

    return {
      success: true,
      result: stdout.trim()
    };
  } catch (error) {
    // エラー時も一時ファイルを削除
    await fs.unlink(inputFile).catch(() => {});

    console.error('Error executing Claude:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 推敲エンドポイント
app.post('/proofread', async (req, res) => {
  const {text} = req.body;

  if (!text) {
    return res.status(400).json({error: 'テキストが指定されていません'});
  }

  console.log('Received proofreading request, text length:', text.length);

  try {
    const result = await proofreadWithClaude(text);
    res.json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'サーバーエラーが発生しました'
    });
  }
});

// チャットエンドポイント（会話履歴を考慮）
app.post('/chat', async (req, res) => {
  const {messages, originalText} = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({error: 'メッセージ履歴が指定されていません'});
  }

  console.log('Received chat request, messages count:', messages.length);

  const tmpDir = os.tmpdir();
  const inputFile = path.join(tmpDir, `claude-chat-${Date.now()}.txt`);

  try {
    // 会話履歴を整形してプロンプトを作成
    let conversationContext = '';

    if (originalText) {
      conversationContext += `【元のテキスト】\n${originalText}\n\n`;
    }

    conversationContext += '【これまでの会話】\n';
    messages.forEach((msg, index) => {
      if (msg.role === 'user') {
        conversationContext += `ユーザー: ${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        conversationContext += `アシスタント: ${msg.content}\n\n`;
      }
    });

    // 一時ファイルに書き込み
    await fs.writeFile(inputFile, conversationContext, 'utf-8');

    // Claude CLIを実行
    const command = `cat "${inputFile}" | claude`;

    console.log('Executing Claude CLI for chat...');
    const {stdout, stderr} = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB
      timeout: 60000 // 60秒タイムアウト
    });

    if (stderr) {
      console.error('Claude CLI stderr:', stderr);
    }

    // 一時ファイルを削除
    await fs.unlink(inputFile).catch(() => {});

    res.json({
      success: true,
      result: stdout.trim()
    });
  } catch (error) {
    // エラー時も一時ファイルを削除
    await fs.unlink(inputFile).catch(() => {});

    console.error('Error executing Claude chat:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
  res.json({status: 'ok'});
});

app.listen(PORT, () => {
  console.log(`Claude proofreading server is running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
