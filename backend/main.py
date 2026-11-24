from itertools import chain

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from pipeline import build_docs, stream_answer, summarize

load_dotenv()
app = FastAPI(title="PageChat API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_origins=["http://localhost:3000", "http://localhost:8000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class ChatPayload(BaseModel):
    url: str = ""
    site: str = ""
    structured: dict = Field(default_factory=dict)
    jsonld: list = Field(default_factory=list)
    fallback_text: str = ""
    question: str = ""
    history: list[dict] = Field(default_factory=list)
    page_type: str = "other"


def _doc_or_error(payload):
    doc = build_docs(payload.model_dump())
    if not doc:
        return None
    return doc


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/chat")
def chat(payload: ChatPayload):
    doc = _doc_or_error(payload)
    if doc is None:
        return JSONResponse(status_code=422, content={"error": "This page did not provide readable text. Refresh the page data and try again."})
    if not payload.question.strip():
        return JSONResponse(status_code=422, content={"error": "Enter a question about this page."})
    try:
        chunks = iter(stream_answer(payload.model_dump(), payload.question[:2000], doc))
        first_chunk = next(chunks)
    except StopIteration:
        return JSONResponse(status_code=503, content={"error": "The assistant returned no answer. Please try again."})
    except Exception as exc:
        return JSONResponse(status_code=503, content={"error": str(exc) or "The page assistant is temporarily unavailable."})

    def generate():
        try:
            for chunk in chain((first_chunk,), chunks):
                content = getattr(chunk, "content", "")
                if isinstance(content, str) and content:
                    yield content
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            yield part.get("text", "")
        except Exception as exc:
            yield "\n\n[PageChat error: " + str(exc) + "]"
    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/summarize")
def summarize_page(payload: ChatPayload):
    doc = _doc_or_error(payload)
    if doc is None:
        return JSONResponse(status_code=422, content={"error": "This page did not provide readable text."})
    try:
        return {"summary": summarize(payload.model_dump(), doc)}
    except Exception as exc:
        return JSONResponse(status_code=503, content={"error": str(exc) or "The page summary is temporarily unavailable."})