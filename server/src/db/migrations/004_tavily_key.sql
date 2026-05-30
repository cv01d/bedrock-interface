-- Encrypted Tavily API key for the web_search tool. Presence enables web search.
ALTER TABLE settings ADD COLUMN enc_tavily_api_key BLOB;
