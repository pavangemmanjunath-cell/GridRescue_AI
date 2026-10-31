"""Ask GridRescue (retrieval-augmented answers over the internal knowledge base) and the assessment history."""
from __future__ import annotations

from fastapi import APIRouter, Body, Query

from app.services import knowledge

router = APIRouter(tags=["knowledge"])


@router.get("/kb/stats", summary="The internal knowledge base: documents by kind, assessments stored, retrieval engine")
async def kb_stats():
    return knowledge.stats()


@router.get("/kb/search", summary="Full-text search (BM25) over the internal knowledge base")
async def kb_search(q: str = Query(..., min_length=2, max_length=300), k: int = Query(6, ge=1, le=20)):
    return {"query": q, "results": knowledge.search(q, k)}


@router.post("/ask", summary="Ask GridRescue: retrieval-augmented answer with numbered sources (extractive; no language model yet)")
async def ask(payload: dict = Body(..., description="{question, context?: {place, facts: [...]}}")):
    q = str(payload.get("question") or "").strip()[:500]
    if len(q) < 2:
        return {"question": q, "answer": "Ask a question about the method, a site, outages, tariffs, ESG or a technology.", "mode": "none", "sources": []}
    return knowledge.ask(q, payload.get("context") or None)


@router.get("/history", summary="Recently assessed sites, from the internal database")
async def history(limit: int = Query(12, ge=1, le=100)):
    return {"assessments": knowledge.history(limit)}
