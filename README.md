# PageChat

PageChat is a Chrome Manifest V3 side panel for questions about the page you are viewing. The extension reads page text locally after you ask a question or choose a quick action, removes email/phone/card-like strings, then sends the extracted content to your configured backend.

## Requirements

- Python 3.10+
- Chrome with Manifest V3 side panel support
- Ollama installed with at least one model downloaded

## Run the backend locally

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Start the Ollama app first so its local API is available at `http://localhost:11434`. PageChat is configured for `llama3.2:3b`. To use another downloaded model, set `OLLAMA_MODEL` in `backend/.env` to its exact name. `OLLAMA_BASE_URL` can be changed if your Ollama service uses another address. No LLM API key is needed. Then start the API from the `backend` directory:

```powershell
uvicorn main:app --reload --port 8000
```

Check `http://localhost:8000/health` for `{"ok":true}`. PageChat splits page text into chunks and ranks them locally using a lightweight word-matching index, so it does not need PyTorch or a separate embedding-model download. Run the sample request from a shell that has curl:

```sh
sh backend/test_curl.sh
```

## Load the extension

1. Generate the toolbar icons with `py extension/generate_icons.py` (the generated PNGs are included).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** and choose **Load unpacked**.
4. Select the repository's `extension` folder.
5. Open a regular article, store listing, or movie page and click the PageChat toolbar icon.
6. Choose a quick question or type a question. Use the gear to change the backend URL.

For a deployed server, replace `https://YOUR-BACKEND.example.com/*` in `extension/manifest.json` with its HTTPS origin, reload the extension, and set that same URL in the side panel settings.

## Selectors

Site-specific selectors live in `extension/selectors.js`. When a site changes its markup, inspect the product or movie page in Chrome DevTools, update the matching CSS selector, then reload the unpacked extension at `chrome://extensions`. The Flipkart selectors are especially likely to need updates. Extraction has JSON-LD, site selector, and Readability/body-text layers so a missing selector does not always prevent questions.

`extension/lib/Readability.js` is Mozilla Readability, distributed under Apache License 2.0; its license text is included beside the source.

## Deploy the backend to Render

The backend is configured to use Ollama on the same computer. For a remote deployment, Ollama must also be available to the backend service; set `OLLAMA_BASE_URL` to a reachable Ollama host and set `OLLAMA_MODEL` to a model installed there. Set the deployed HTTPS URL in the extension host permissions and side panel settings. Do not expose an unauthenticated Ollama service to the public internet.

## Manual extraction checklist

- [ ] Amazon product page: title, price, features, reviews, and shopping questions
- [ ] Flipkart product page: title, price, specifications, and reviews
- [ ] IMDb title page: synopsis, rating, critic score, and spoiler-free summary
- [ ] News site: article extraction and short summary
- [ ] Wikipedia: article extraction and factual page questions

## Privacy notes

When the side panel is open, page text is extracted locally on panel startup and refreshed when you change tabs or navigate to a new URL. Page text is sent to the backend only when you ask a question or choose a quick action. Browser, banking, email, sign-in, and payment pages are blocked. The extension redacts email addresses, phone-like strings, and card-like numbers and caps page text and requests before transmission. Chat is saved per page URL in `chrome.storage.session`.
