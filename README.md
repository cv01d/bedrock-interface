# Bedrock LLM-Interface
A small extremely simple local chat interface for Amazon Bedrock. Pick any Bedrock model, organize
chats under projects (system prompt + project data + rolling memory), and give the model
built-in tools for searching your past chats, generating images, and searching the web.
All chat history and credentials are encrypted at rest in SQLite.

## Features

- **Any Bedrock chat model** — in-region models and cross-region inference profiles,
  with running per-chat cost and token tracking.
- **Projects** — group chats under a system prompt + project data, with a rolling
  memory summary the model carries across chats.
- **Attachments** — upload images (vision) and documents (pdf/csv/docx/xlsx/…);
  images render inline in the transcript.
- **Image generation** — `generate_image` tool backed by a Bedrock image model
  (Amazon Nova Canvas / Titan, or Stability), selectable in Settings. Generated
  images are saved as attachments and shown in the chat.
- **Web search** — `web_search` tool backed by [Tavily](https://tavily.com); add an
  API key in Settings to enable it. Results render as a clickable sources list.
- **Chat history search** — `search_chat_history` tool lets the model pull facts
  from your earlier conversations.
- **Prompt caching** on supported models, with estimated cache-token cost accounting.

> Tools (history/image/web search) are only offered to tool-capable models
> (Anthropic Claude and Amazon Nova). Image generation and web search also require
> the relevant Settings config to be present.

## Stack

- **Server**: Node.js + Express + TypeScript, SQLite via the built-in `node:sqlite`
- **Client**: React + Vite + TypeScript
- **AWS**: Bedrock Converse API (`@aws-sdk/client-bedrock-runtime`), credentials stored
  encrypted in the Settings table and decrypted at request time

## Setup

Requires Node 22.5+ (uses the built-in `node:sqlite`; tested on Node 26).

```bash
npm install

# Generate a 32-byte master key and put it in .env
npm run keygen           # prints a base64 key
# set MASTER_KEY=<that value> in .env  (PORT defaults to 3000)

npm run dev              # server on :3000, client on :5173 (proxies /api)
```

Open http://localhost:5173, go to **Settings**, and enter your AWS access key, secret,
and region. Saving runs a Bedrock smoke test and reports how many models are reachable.
Then pick a summarizer model (a small/cheap one like Haiku or Nova Lite).

Optional, in the same Settings page:

- **Image model** — pick one of the image-generation models your account can invoke
  (e.g. Nova Canvas, Titan Image, or a Stability model) to enable the `generate_image`
  tool. Leave it off to disable image generation.
- **Tavily API key** — paste a key from [tavily.com](https://tavily.com) to enable the
  `web_search` tool (free tier ≈ 1,000 searches/month). It's encrypted at rest like your
  AWS credentials.

> **MASTER_KEY** encrypts everything sensitive at rest. If you lose it, encrypted data
> (messages, project content, AWS credentials) is unrecoverable. Keep it out of source
> control — it's only ever read from `.env`.

## Required IAM permissions

The AWS credentials you save need:

```
bedrock:Converse
bedrock:ConverseStream
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
```

Newer Claude models (Sonnet 4/4.5, Opus 4/4.7, Haiku 3.5) require a **cross-region
inference profile** rather than a bare model id — these are grouped under "Cross-region"
in the model picker. You must also have requested model access for the models you intend
to use in the Bedrock console.

> Some accounts now enforce the dedicated `bedrock:Converse` / `bedrock:ConverseStream`
> actions (this app uses the Converse API). If you scope IAM tightly, include those two
> alongside the `InvokeModel*` actions.

## Project layout

- `shared/` — TypeScript types shared by server and client
- `server/` — Express API, SQLite + encryption, Bedrock integration, summarizer
- `client/` — React UI (Chat / Projects / Settings views)
- `server/data/` — SQLite DB + uploaded attachments (gitignored)

Note: Pricing and tokens may vary per chat and/or model. It is ok to use as a guide for estimating, but do not rely on it.

## Scripts

- `npm run dev` — run server + client together
- `npm run build` — typecheck the server and build the client bundle
- `npm run start` — run the server (serves the built client if `client/dist` exists)
- `npm run keygen` — print a fresh base64 MASTER_KEY


## Screenshots

<img width="1001" height="564" alt="Screenshot 2026-05-30 at 2 21 29 PM" src="https://github.com/user-attachments/assets/1c496fc4-bc47-4323-993d-4158cce55e65" />
<img width="1017" height="724" alt="Screenshot 2026-05-30 at 2 22 28 PM" src="https://github.com/user-attachments/assets/50df67e1-6511-4310-83dd-0f86793d5c91" />
<img width="1008" height="713" alt="Screenshot 2026-05-30 at 2 24 09 PM" src="https://github.com/user-attachments/assets/c3334c50-9beb-4910-bff2-f5337c08298f" />
<img width="1336" height="722" alt="Screenshot 2026-05-28 at 6 39 10 PM" src="https://github.com/user-attachments/assets/b25171a8-cd07-48ce-b0b5-6f4b408fc280" />
<img width="1394" height="713" alt="Screenshot 2026-05-28 at 6 39 45 PM" src="https://github.com/user-attachments/assets/57c3b671-eca2-4099-9b53-d17abd171dfa" />
