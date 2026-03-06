"""
StudyBuddy — AI-powered PDF Study Assistant
============================================
Backend powered by FastAPI, OpenAI (GPT-4o-mini, Whisper, TTS),
and a lightweight in-memory RAG pipeline using OpenAI embeddings.
"""

import os
import re
import uuid
import json
import time
import logging
import hashlib
from io import BytesIO
from typing import List, Optional, Dict

import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from openai import AsyncOpenAI
from sklearn.metrics.pairwise import cosine_similarity
import pypdf
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------
MAX_FILE_SIZE_MB = 25
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_CONTEXTS = 30
CONTEXT_TTL_SECONDS = 7200  # 2 hours
CHUNK_SIZE = 600           # characters per chunk
CHUNK_OVERLAP = 100        # overlap between chunks
TOP_K = 6                  # top-k chunks for RAG retrieval
EMBED_MODEL = "text-embedding-3-small"
CHAT_MODEL = "gpt-4o-mini"

# ---------------------------------------------------------------------------
#  Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
#  App
# ---------------------------------------------------------------------------
app = FastAPI(title="StudyBuddy API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ---------------------------------------------------------------------------
#  OpenAI Client
# ---------------------------------------------------------------------------
api_key = os.getenv("OPENAI_API_KEY", "")
if not api_key:
    logger.warning("OPENAI_API_KEY is not set. API calls will fail.")

client = AsyncOpenAI(api_key=api_key)

# ---------------------------------------------------------------------------
#  In-Memory RAG Store
# ---------------------------------------------------------------------------
# pdf_contexts[context_id] = {
#   "filename", "pages", "size_bytes", "created_at",
#   "full_text",
#   "chunks": [str, ...],
#   "embeddings": np.ndarray   # shape (n_chunks, embed_dim)
# }
pdf_contexts: Dict[str, dict] = {}


def cleanup_old_contexts():
    """Remove contexts older than TTL."""
    now = time.time()
    expired = [
        cid for cid, ctx in pdf_contexts.items()
        if now - ctx["created_at"] > CONTEXT_TTL_SECONDS
    ]
    for cid in expired:
        del pdf_contexts[cid]
        logger.info(f"Cleaned up expired context: {cid}")


# ---------------------------------------------------------------------------
#  Text Chunking (for RAG)
# ---------------------------------------------------------------------------
def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks at sentence boundaries."""
    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks = []
    current_chunk = ""

    for sentence in sentences:
        if len(current_chunk) + len(sentence) > chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            # Keep overlap from the end of the last chunk
            words = current_chunk.split()
            overlap_words = words[-min(len(words), overlap // 5):]
            current_chunk = " ".join(overlap_words) + " " + sentence
        else:
            current_chunk += " " + sentence if current_chunk else sentence

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


async def get_embeddings(texts: List[str]) -> np.ndarray:
    """Get OpenAI embeddings for a batch of texts."""
    # Process in batches of 100 (API limit)
    all_embeddings = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = await client.embeddings.create(
            model=EMBED_MODEL,
            input=batch
        )
        batch_embeddings = [item.embedding for item in response.data]
        all_embeddings.extend(batch_embeddings)
    return np.array(all_embeddings)


async def retrieve_relevant_chunks(query: str, context_id: str, top_k: int = TOP_K) -> List[str]:
    """RAG retrieval — find most relevant chunks for a query."""
    ctx = pdf_contexts.get(context_id)
    if not ctx or "embeddings" not in ctx:
        return []

    query_embedding = await get_embeddings([query])
    similarities = cosine_similarity(query_embedding, ctx["embeddings"])[0]

    # Get top-k indices
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    # Only return chunks with similarity above a threshold
    relevant_chunks = []
    for idx in top_indices:
        if similarities[idx] > 0.15:  # minimum relevance threshold
            relevant_chunks.append(ctx["chunks"][idx])

    return relevant_chunks


# ---------------------------------------------------------------------------
#  Pydantic Models
# ---------------------------------------------------------------------------
class Message(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        if v not in ("user", "assistant", "system"):
            raise ValueError("Role must be 'user', 'assistant', or 'system'")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if len(v) > 50000:
            raise ValueError("Message content too long (max 50,000 chars)")
        return v


class ChatRequest(BaseModel):
    messages: List[Message]
    context_id: Optional[str] = None


class TTSRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, v):
        if len(v) > 4096:
            raise ValueError("TTS text too long (max 4096 chars)")
        return v


class QuizRequest(BaseModel):
    context_id: str
    topic: Optional[str] = None
    num_questions: int = 5


class FlashcardRequest(BaseModel):
    context_id: str
    topic: Optional[str] = None
    num_cards: int = 8


class SummaryRequest(BaseModel):
    context_id: str
    detail_level: str = "medium"  # brief, medium, detailed


# ---------------------------------------------------------------------------
#  Routes
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "3.0.0",
        "active_contexts": len(pdf_contexts),
        "api_key_configured": bool(api_key),
    }


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        content = await file.read()

        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_FILE_SIZE_MB}MB",
            )

        cleanup_old_contexts()

        if len(pdf_contexts) >= MAX_CONTEXTS:
            oldest_id = min(pdf_contexts, key=lambda k: pdf_contexts[k]["created_at"])
            del pdf_contexts[oldest_id]
            logger.info(f"Evicted oldest context: {oldest_id}")

        pdf_file = BytesIO(content)
        reader = pypdf.PdfReader(pdf_file)

        text = ""
        for page_num, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text:
                text += f"\n[Page {page_num + 1}]\n{page_text}\n"

        if not text.strip():
            raise HTTPException(
                status_code=400, detail="Could not extract text from PDF. The file may be scanned or image-based."
            )

        # Chunk the text for RAG
        chunks = chunk_text(text.strip())
        logger.info(f"Created {len(chunks)} chunks from {file.filename}")

        # Generate embeddings for all chunks
        embeddings = await get_embeddings(chunks)
        logger.info(f"Generated embeddings: shape {embeddings.shape}")

        context_id = str(uuid.uuid4())
        pdf_contexts[context_id] = {
            "full_text": text.strip(),
            "filename": file.filename,
            "pages": len(reader.pages),
            "size_bytes": len(content),
            "created_at": time.time(),
            "chunks": chunks,
            "embeddings": embeddings,
        }

        logger.info(f"Uploaded PDF: {file.filename} ({len(reader.pages)} pages, {len(content)} bytes) -> {context_id}")

        return {
            "success": True,
            "context_id": context_id,
            "message": "PDF processed and indexed successfully",
            "filename": file.filename,
            "pages": len(reader.pages),
            "size_kb": round(len(content) / 1024, 1),
            "chunks": len(chunks),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing PDF upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to process PDF file")


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    # Get the latest user message for RAG retrieval
    user_message = ""
    for m in reversed(messages):
        if m["role"] == "user":
            user_message = m["content"]
            break

    # RAG: retrieve relevant chunks
    rag_context = ""
    if request.context_id and request.context_id in pdf_contexts:
        ctx = pdf_contexts[request.context_id]
        relevant_chunks = await retrieve_relevant_chunks(user_message, request.context_id)

        if relevant_chunks:
            rag_context = "\n\n---\n\n".join(relevant_chunks)
            logger.info(f"RAG: Retrieved {len(relevant_chunks)} relevant chunks for query")

        system_prompt = (
            "You are StudyBuddy, an AI study assistant designed to help students understand their notes and study materials. "
            "You are friendly, patient, and excellent at explaining complex concepts in simple terms. "
            "You encourage critical thinking by asking follow-up questions when appropriate.\n\n"
            "CAPABILITIES:\n"
            "- Answer questions about the uploaded study material\n"
            "- Explain concepts at different difficulty levels\n"
            "- Help students prepare for exams with cross-questions\n"
            "- Provide examples and analogies to clarify difficult topics\n"
            "- Summarize sections of notes\n"
            "- Create practice questions from the material\n\n"
            "RULES:\n"
            "- IMPORTANT: You MUST ONLY answer based on the provided notes and context. Do NOT use outside knowledge.\n"
            "- If the answer to the student's question is not contained in the provided notes, you MUST politely refuse to answer and state that the information is not in the uploaded document.\n"
            "- Always cite which part of the notes your answer comes from when possible\n"
            "- Use markdown formatting for readability (headers, bullet points, bold, etc.)\n"
            "- Match the student's language — if they write in Urdu, respond in Urdu, etc.\n"
            "- When explaining, use step-by-step breakdowns\n\n"
            "RELEVANT SECTIONS FROM THE STUDENT'S NOTES:\n"
            f"--- START OF RELEVANT NOTES ---\n{rag_context}\n--- END OF RELEVANT NOTES ---\n\n"
            f"Full document: '{ctx['filename']}' ({ctx['pages']} pages)"
        )

        has_system = any(m["role"] == "system" for m in messages)
        if not has_system:
            messages.insert(0, {"role": "system", "content": system_prompt})
        else:
            for i, m in enumerate(messages):
                if m["role"] == "system":
                    messages[i]["content"] = system_prompt
                    break
    else:
        general_system_prompt = (
            "You are StudyBuddy, an AI study assistant. "
            "Help students learn effectively. Be clear, friendly, and encouraging. "
            "Use markdown formatting for readability. "
            "Match the student's language — if they write in Urdu, respond in Urdu, etc. "
            "You MUST inform the user that you are restricted to answering questions based strictly on uploaded PDF documents. "
            "Politely refuse to answer generic questions and instruct them to upload a PDF to begin."
        )
        has_system = any(m["role"] == "system" for m in messages)
        if not has_system:
            messages.insert(0, {"role": "system", "content": general_system_prompt})

    async def generate_events():
        try:
            stream = await client.chat.completions.create(
                model=CHAT_MODEL,
                messages=messages,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'content': content})}\n\n"
        except Exception as e:
            logger.error(f"Chat streaming error: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate_events(), media_type="text/event-stream")


@app.post("/api/quiz")
async def generate_quiz(request: QuizRequest):
    """Generate a quiz from the uploaded notes."""
    ctx = pdf_contexts.get(request.context_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="PDF context not found. Please upload your notes first.")

    topic_instruction = f"Focus specifically on the topic: {request.topic}" if request.topic else "Cover the key concepts from the entire document"

    prompt = (
        f"Based on the following study notes, generate exactly {request.num_questions} quiz questions "
        f"to test understanding. {topic_instruction}.\n"
        "IMPORTANT: You MUST ONLY use the provided notes. Do NOT include outside information or concepts not found in these notes.\n\n"
        "Return ONLY valid JSON in this format:\n"
        '{"questions": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], '
        '"correct": "A", "explanation": "..."}]}\n\n'
        f"Notes:\n{ctx['full_text'][:8000]}"
    )

    try:
        response = await client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": "You are a quiz generator for students. Generate clear, educational multiple-choice questions. Always return valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
        )
        quiz_data = json.loads(response.choices[0].message.content)
        return quiz_data
    except Exception as e:
        logger.error(f"Quiz generation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate quiz")


@app.post("/api/flashcards")
async def generate_flashcards(request: FlashcardRequest):
    """Generate flashcards from the uploaded notes."""
    ctx = pdf_contexts.get(request.context_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="PDF context not found. Please upload your notes first.")

    topic_instruction = f"Focus on: {request.topic}" if request.topic else "Cover the most important concepts"

    prompt = (
        f"Based on these study notes, create {request.num_cards} flashcards for studying. "
        f"{topic_instruction}.\n"
        "IMPORTANT: You MUST ONLY use the provided notes. Do NOT include outside information or concepts not found in these notes.\n\n"
        "Return ONLY valid JSON:\n"
        '{"flashcards": [{"front": "Question or term", "back": "Answer or definition", "category": "topic area"}]}\n\n'
        f"Notes:\n{ctx['full_text'][:8000]}"
    )

    try:
        response = await client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": "You are a flashcard creator for students. Create concise, effective flashcards. Always return valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
        )
        cards = json.loads(response.choices[0].message.content)
        return cards
    except Exception as e:
        logger.error(f"Flashcard generation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate flashcards")


@app.post("/api/summary")
async def generate_summary(request: SummaryRequest):
    """Generate a summary of the uploaded notes."""
    ctx = pdf_contexts.get(request.context_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="PDF context not found.")

    detail_map = {
        "brief": "Create a brief 3-5 sentence summary highlighting the key points.",
        "medium": "Create a structured summary with key headings, bullet points, and main takeaways. About 300-500 words.",
        "detailed": "Create a comprehensive, detailed summary organized by topic with examples. About 600-1000 words.",
    }

    prompt = (
        f"{detail_map.get(request.detail_level, detail_map['medium'])}\n"
        "IMPORTANT: You MUST ONLY summarize the provided notes. Do NOT include outside information.\n\n"
        f"Notes:\n{ctx['full_text'][:12000]}"
    )

    try:
        response = await client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": "You are a study assistant. Create clear, well-organized summaries using markdown formatting."},
                {"role": "user", "content": prompt}
            ],
        )
        return {"summary": response.choices[0].message.content}
    except Exception as e:
        logger.error(f"Summary generation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate summary")


@app.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    try:
        content = await audio.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio file too large (max 10MB)")

        audio_file = BytesIO(content)
        audio_file.name = audio.filename or "recording.webm"

        transcription = await client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
        )
        return {"text": transcription.text}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to transcribe audio")


@app.post("/api/tts")
async def generate_tts(request: TTSRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    try:
        response = await client.audio.speech.create(
            model="tts-1",
            voice="nova",  # Friendly, warm voice for students
            input=request.text,
            response_format="mp3",
        )
        audio_bytes = response.read()
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate speech")


@app.post("/api/tts/stream")
async def stream_tts_pcm(request: TTSRequest):
    """Streaming PCM TTS for ultra-low latency voice calls."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    import httpx

    async def generate():
        try:
            async with httpx.AsyncClient() as http_client:
                async with http_client.stream(
                    "POST",
                    "https://api.openai.com/v1/audio/speech",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "tts-1",
                        "voice": "nova",
                        "input": request.text,
                        "response_format": "pcm",
                    },
                    timeout=30.0,
                ) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        logger.error(f"OpenAI TTS stream error {response.status_code}: {error_body[:200]}")
                        return
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        yield chunk
        except Exception as e:
            logger.error(f"Streaming TTS error: {e}", exc_info=True)

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={
            "X-Audio-Format": "pcm-24000-16bit-mono",
            "Cache-Control": "no-cache",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
