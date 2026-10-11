# Provider examples

[Documentation](./README.md) · [Project overview](../README.md)

Use an endpoint that supports the OpenAI-compatible `/chat/completions` request format. The defaults target DeepSeek. Set the model and API key separately; model availability depends on your provider. Switching endpoints requires approval before the single stored key is sent to the new destination. See [Configuration](./configuration.md#select-an-api-base-url) for the API base URL picker.

## OpenAI

```json
{
  "aiCommit.apiBaseUrl": "https://api.openai.com/v1",
  "aiCommit.model": "gpt-6-luna"
}
```

## DeepSeek

```json
{
  "aiCommit.apiBaseUrl": "https://api.deepseek.com/v1",
  "aiCommit.model": "deepseek-flash"
}
```

## Kimi and GLM

The API picker includes `https://api.moonshot.cn/v1` for Kimi and `https://open.bigmodel.cn/api/paas/v4` for GLM. Select a model supported by your account and configure its API key.

## Local Ollama

```json
{
  "aiCommit.apiBaseUrl": "http://localhost:11434/v1",
  "aiCommit.model": "llama3",
  "aiCommit.apiKey": ""
}
```

Start Ollama and ensure the selected model is installed. For a local endpoint that requires no authentication, run **Simple AI Committer: Clear Stored API Key** and leave `aiCommit.apiKey` empty. Otherwise, the stored key would require destination approval before being sent even if the settings field is empty.

## Claude, Gemini, and other models

Use an OpenAI-compatible gateway or endpoint offered by your provider. The extension does not implement Anthropic's native Messages API or Google's native Gemini API. Enter the compatible base URL and the model ID accepted by that endpoint.
