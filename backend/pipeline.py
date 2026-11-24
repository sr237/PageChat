import hashlib
import json
import math
import os
import re
import threading
from collections import OrderedDict
from collections import Counter
from urllib.error import URLError
from urllib.request import urlopen

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()
_SPLITTER = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
_TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)
_STOP_WORDS = {"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "who", "why", "with"}


def build_docs(payload):
    parts = []
    structured = payload.get("structured") or {}
    for key, value in structured.items():
        if isinstance(value, list):
            if key == "reviews":
                value = "\n".join(f"Reviews excerpt {index}: {item}" for index, item in enumerate(value, 1))
            else:
                value = "\n".join(map(str, value))
        elif isinstance(value, dict):
            value = "\n".join(f"{k}: {v}" for k, v in value.items())
        parts.append(f"{key}: {value}")
    jsonld = payload.get("jsonld") or []
    jsonld_text = "\n".join(str(item) for item in jsonld)[:5000]
    if jsonld_text:
        parts.append("Structured page data:\n" + jsonld_text)
    fallback = (payload.get("fallback_text") or "")[:20000]
    if fallback:
        parts.append("Page text:\n" + fallback)
    text = "\n".join(parts).strip()
    if not text:
        return None
    return Document(page_content=text, metadata={"url": payload.get("url", ""), "site": payload.get("site", "")})


def _cache_key(doc):
    content_hash = hashlib.sha256(doc.page_content.encode("utf-8")).hexdigest()
    return hashlib.sha256((doc.metadata.get("url", "") + content_hash).encode("utf-8")).hexdigest()


def _get_chunks(doc):
    key = _cache_key(doc)
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    chunks = _SPLITTER.split_documents([doc])
    with _CACHE_LOCK:
        _CACHE[key] = chunks
        while len(_CACHE) > 20:
            _CACHE.popitem(last=False)
    return chunks


def _rank_chunks(chunks, question, limit):
    query_terms = set(_TOKEN_RE.findall(question.lower())) - _STOP_WORDS
    if not query_terms:
        return chunks[:limit]
    chunk_terms = [Counter(_TOKEN_RE.findall(chunk.page_content.lower())) for chunk in chunks]
    document_frequency = Counter(term for counts in chunk_terms for term in counts)
    scored = []
    for index, (chunk, counts) in enumerate(zip(chunks, chunk_terms)):
        score = 0.0
        for term in query_terms:
            frequency = counts.get(term, 0)
            if frequency:
                inverse_frequency = math.log(1 + len(chunks) / (1 + document_frequency[term]))
                score += (1 + math.log(frequency)) * inverse_frequency
        if query_terms.intersection({"negative", "negatives", "complaint", "complaints", "bad", "worst"}):
            if re.search(r"\b[1-2](?:\.\d)?\s*(?:out of 5|/\s*5)\b", chunk.page_content, re.I):
                score += 8
            score += sum(counts.get(term, 0) for term in {"bad", "poor", "broken", "waste", "disappointed", "returned", "refund", "defect", "issue", "problem"})
        scored.append((score, -index, chunk))
    return [item[2] for item in sorted(scored, reverse=True)[:limit]]


def retrieve(doc, question, summarize=False):
    chunks = _get_chunks(doc)
    if summarize:
        selected = chunks[:4]
        # Keep review excerpts represented in a summary when they occur late in the page.
        reviews = [chunk for chunk in chunks if re.search(r"review|critic|audience", chunk.page_content, re.I)]
        selected.extend(reviews[:2])
        return selected[:6]
    return _rank_chunks(chunks, question, 4)


def _llm():
    from langchain_ollama import ChatOllama
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "llama3.2:3b").strip()
    if not model:
        try:
            with urlopen(f"{base_url}/api/tags", timeout=3) as response:
                installed = json.load(response).get("models", [])
            if not installed:
                raise RuntimeError("Ollama is running, but no models are installed. Download a model in Ollama, then restart PageChat.")
            model = installed[0].get("name", "")
        except URLError as exc:
            raise RuntimeError(f"Cannot reach Ollama at {base_url}. Start the Ollama app and make sure its local service is running.") from exc
    return ChatOllama(
        model=model,
        base_url=base_url,
        temperature=0,
        num_ctx=8192,
        num_predict=512,
        client_kwargs={"timeout": 180},
    )


def _messages(payload, question, docs):
    from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
    from prompts import system_prompt
    context = "\n\n---\n\n".join(d.page_content for d in docs)
    system = system_prompt(payload.get("page_type", "other")) + "\n\nPAGE CONTENT (the only source of facts):\n" + context
    messages = [SystemMessage(content=system)]
    for item in (payload.get("history") or [])[-6:]:
        role = item.get("role")
        content = str(item.get("content", ""))[:4000]
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=question))
    return messages


def stream_answer(payload, question, doc):
    docs = retrieve(doc, question)
    return _llm().stream(_messages(payload, question, docs))


def summarize(payload, doc):
    docs = retrieve(doc, "Summarize what is going on on this page", summarize=True)
    llm = _llm()
    response = llm.invoke(_messages(payload, "Give a short 'what is going on here' summary of this page.", docs))
    return response.content
