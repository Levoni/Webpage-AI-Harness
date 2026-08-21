'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const HomeAssistantClient = require('./HomeAssistantClient.js');
const EntityStore = require('./entityStore.js');
const { availableTools, ToolHandler } = require('./toolReference.js');
const express = require('express');
const cors = require('cors');


process.loadEnvFile();
const ha = new HomeAssistantClient({
  url: process.env.HA_URL,
  token: process.env.HA_TOKEN
});
const entityStore = new EntityStore(ha);
const toolHandler = new ToolHandler(ha, entityStore);

// ── Config ─────────────────────────────────────────────────────────
const WHISPER_CLI = process.env.WHISPER_CLI || './whisper.cpp/build/bin/Release/whisper-cli.exe';
const WHISPER_MODEL = process.env.WHISPER_MODEL || './whisper.cpp/ggml-base.bin';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
// Ollama listens on localhost by default, port 11434
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

// Scratch dir for uploads + intermediate files
const WORK_DIR = path.join(os.tmpdir(), `whisper-${process.pid}`);
fs.mkdirSync(WORK_DIR, { recursive: true });


// Promise wrapper: resolve when the command exits 0
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        console.error(`[ERROR] ${cmd} failed: ${stderr}`);
        reject(new Error(`${cmd} → ${err.message} | ${stderr}`));
      } else {
        resolve(_stdout);
      }
    });
  });
}

// ── The core method: webm → wav → whisper.cpp → console ──────────
async function transcribeAudio(webmPath) {
  const wavPath = `${webmPath}.wav`;
  const txtPath = `${webmPath}.txt`;

  // First, inspect the WebM file to understand its format
  console.log(`[ffprobe] Analyzing input WebM file: ${webmPath}`);
  const webmStats = fs.statSync(webmPath);
  console.log(`[ffprobe] WebM file size: ${webmStats.size} bytes`);

  // whisper.cpp only reads WAV — decode webm (Opus) to 16 kHz mono s16
  // Key: Use -vn to disable video, and specify Opus codec explicitly
  console.log(`[ffmpeg] Converting ${webmPath} to ${wavPath}`);
  await run(FFMPEG, [
    '-i', webmPath,
    '-vn',              // no video
    '-acodec', 'pcm_s16le',  // output codec
    '-ar', '16000',     // 16kHz sample rate (Whisper standard)
    '-ac', '1',         // mono
    '-af', 'volume=1.5', // boost volume in case it's quiet
    wavPath,
  ]);

  // Verify WAV file was created and has content
  const wavStats = fs.statSync(wavPath);
  console.log(`[ffmpeg] WAV file size: ${wavStats.size} bytes`);

  if (wavStats.size < 1000) {
    throw new Error(`WAV file too small (${wavStats.size} bytes) - audio may be empty or invalid`);
  }

  console.log(`[whisper] Transcribing ${wavPath} with model ${WHISPER_MODEL}`);
  await run(WHISPER_CLI, [
    '-m', WHISPER_MODEL,
    '-f', wavPath,
    '-otxt',          // emit plain text output
    '-of', webmPath,  // transcript written to <webmPath>.txt
    '-t', '4',        // use 4 threads
    // '-l', 'en',     // uncomment to force English (skips language detection, faster)
  ]);

  const text = fs.readFileSync(txtPath, 'utf8');
  console.log(`[whisper] Transcription result: "${text.trim()}"`); // ← printed to the console
  return text;
}

/**
 * Send a text string to an Ollama model and return the model's reply.
 *
 * @param {string} model  - Model name (e.g. "llama3", "llama3:8b", "mistral")
 * @param {array<String>} text   - The text string to send to the model
 * @param {object} [opts] - Optional settings
 * @returns {Promise<string>} The model's response text
 */
async function sendTextToOllama(model, chat, { system, stream = false, tools = null } = {}) {
  let messages = [];
  if (system) messages.push({ role: "system", content: system });

  chat.forEach((msg) => {
    messages.push(msg);
  });

  // console.log(`Sending to Ollama: ${JSON.stringify({ model, messages, stream, tools })}`);

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream, tools }),
  }).catch((err) => {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
  });

  if (!res.ok) {
    console.log(await res.text());
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // console.log(`Ollama response: ${JSON.stringify(data)}`);
  return data;
}

async function kokoroSpeech(text, {
  baseUrl = 'http://192.168.0.175:8880',
  voice = 'af_heart',
  speed = 1.0,
  responseFormat = 'mp3'
} = {}) {
  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice,
      speed,
      response_format: responseFormat
    })
  });

  if (!response.ok) {
    throw new Error(
      `Kokoro-FastAPI error ${response.status}: ${await response.text()}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

// ── API ────────────────────────────────────────────────────────────
const app = express();

app.use(cors());



app.post(
  '/transcribe',
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  async (req, res) => {
    const audio = req.body;

    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      return res.status(400).json({
        error: 'Missing body: send the audio bytes as a raw application/octet-stream body.'
      });
    }

    // octet-stream carries no format info, so write it as .webm to match
    // whatever transcribeAudio expects (adjust the extension if needed).
    const webmPath = path.join(WORK_DIR, `${crypto.randomBytes(8).toString('hex')}.webm`);

    try {
      await fsp.writeFile(webmPath, audio);
      const text = await transcribeAudio(webmPath);
      if (text === `"[BLANK_AUDIO]"`) {
        return res.status(400).json({ error: 'No text detected in audio.' });
      }

      if (text.toLowerCase().startsWith('home')) {
        const chat = [{ role: 'user', content: text }];
        let reply = await sendTextToOllama('4skl/gemma4-e4b-mtp', chat, { system: 'You are a home assistant agent.', tools: availableTools });
        while (reply.message.tool_calls && reply.message.tool_calls.length > 0) {
          let toolResults = [];
          for (const toolCall of reply.message.tool_calls) {
            console.log(`Tool call: ${toolCall.function.name} with arguments: ${JSON.stringify(toolCall.function.arguments)}`);
            let result = await toolHandler.handleTool(toolCall.function.name, toolCall.function.arguments);
            chat.push({role: 'user', content: `${result}`});
          }
          reply = await sendTextToOllama('4skl/gemma4-e4b-mtp', chat, { system: 'You are a home assistant agent who gives a status of what changed once all tools are used.', tools: availableTools });
        }
        // console.log(`Creating audio reply for: ${reply}`);
        const audioBuffer = await kokoroSpeech(reply.message.content, { voice: 'af_heart', speed: 1.0, responseFormat: 'mp3' });
        res.json({ reply: reply.message.content, audio: audioBuffer });
      } else {
        const reply = await sendTextToOllama('4skl/gemma4-e4b-mtp', text, { system: 'You are a helpful assistant. You will keep responses succinct and within a 250 word limit while including all important perspectives.' });
        // console.log(`Creating audio reply for: ${reply.message.content}`);
        const audioBuffer = await kokoroSpeech(reply.message.content, { voice: 'af_heart', speed: 1.0, responseFormat: 'mp3' });
        console.log('sending reply');
        res.json({ reply: reply.message.content, audio: audioBuffer });
      }
    } catch (err) {
      console.log('Error in transcribe:', err);
      res.status(500).json({ error: err.message });
    } finally {
      const tempFiles = [webmPath, `${webmPath}.wav`, `${webmPath}.txt`, `${webmPath}.srt`];
      await Promise.all(tempFiles.map((f) => fsp.rm(f, { force: true }).catch(() => { })));
    }
  }
);

async function StartServer() {
  try {
    await entityStore.initialize();

    ha.turnOnLight('light.living_room_living_room', { brightness: 200 });

    app.listen(3000, () => console.log('listening on :3000'));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

StartServer();