# Bedrock LLM-Interface
A small extremely simple local chat interface for Amazon Bedrock. Pick any Bedrock model, organize
chats under projects (system prompt + project data + rolling memory), and let the
model search your past chats with a built-in tool. All chat history and credentials
are encrypted at rest in SQLite.

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

<img width="1391" height="730" alt="Screenshot 2026-05-28 at 6 38 01 PM" src="https://github.com/user-attachments/assets/4e8e614e-14e2-4461-923f-3d8b00f0c5bf" />
<img width="1391" height="739" alt="Screenshot 2026-05-28 at 6 38 31 PM" src="https://github.com/user-attachments/assets/51e1753d-6d51-42e9-a4ef-8cc15fa70d47" />
<img width="1336" height="722" alt="Screenshot 2026-05-28 at 6 39 10 PM" src="https://github.com/user-attachments/assets/b25171a8-cd07-48ce-b0b5-6f4b408fc280" />
<img width="1394" height="713" alt="Screenshot 2026-05-28 at 6 39 45 PM" src="https://github.com/user-attachments/assets/57c3b671-eca2-4099-9b53-d17abd171dfa" />
