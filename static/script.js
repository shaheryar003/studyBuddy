/**
 * StudyBuddy — AI-Powered PDF Study Assistant
 * =============================================
 * Complete frontend JavaScript:
 *  - PDF upload + RAG-powered chat
 *  - Quiz generation & interactive quiz UI
 *  - Flashcard generation with flip animation
 *  - Voice conversation (VAD + Whisper + Streaming PCM TTS)
 *  - Ambient background animation
 *  - Toast notifications
 */

document.addEventListener('DOMContentLoaded', () => {

    // ==================== STATE ====================
    let currentContextId = null;
    let chatHistory = [];
    let isGenerating = false;

    // Call State
    let mediaRecorder = null;
    let micStream = null;
    let audioChunks = [];
    let isCallMode = false;
    let activePipeline = null;
    let activeVAD = null;
    let speechRecognition = null;

    // Quiz State
    let quizQuestions = [];
    let quizScore = 0;
    let quizAnswered = 0;

    // Flashcard State
    let flashcards = [];
    let currentCardIndex = 0;

    // ==================== DOM ELEMENTS ====================
    const welcomeView = document.getElementById('welcome-view');
    const chatView = document.getElementById('chat-view');
    const quizView = document.getElementById('quiz-view');
    const flashcardView = document.getElementById('flashcard-view');

    // Sidebar
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const uploadDropzone = document.getElementById('upload-dropzone');
    const uploadProgress = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const activeDoc = document.getElementById('active-doc');
    const docName = document.getElementById('doc-name');
    const docMeta = document.getElementById('doc-meta');
    const docRemove = document.getElementById('doc-remove');

    // Tools
    const toolSummary = document.getElementById('tool-summary');
    const toolQuiz = document.getElementById('tool-quiz');
    const toolFlashcards = document.getElementById('tool-flashcards');
    const toolVoice = document.getElementById('tool-voice');
    const newChatBtn = document.getElementById('new-chat-btn');
    const brandLogo = document.getElementById('brand-logo');

    // Chat
    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const attachBtn = document.getElementById('attach-btn');
    const voiceBtn = document.getElementById('voice-btn');

    // Quiz
    const quizContainer = document.getElementById('quiz-container');
    const quizLoading = document.getElementById('quiz-loading');
    const quizScoreEl = document.getElementById('quiz-score');
    const quizBackBtn = document.getElementById('quiz-back-btn');

    // Flashcard
    const flashcardContainer = document.getElementById('flashcard-container');
    const flashcardLoading = document.getElementById('flashcard-loading');
    const flashcardCounter = document.getElementById('flashcard-counter');
    const flashcardBackBtn = document.getElementById('flashcard-back-btn');

    // Call Overlay
    const callOverlay = document.getElementById('call-overlay');
    const endCallBtn = document.getElementById('end-call-btn');
    const callStatus = document.getElementById('call-status');
    const callSubtitle = document.getElementById('call-subtitle');
    const liveTranscriptEl = document.getElementById('live-transcript');
    const callWaveBars = document.querySelectorAll('.call-wave-bars span');

    // Feature Cards (welcome page)
    const featureChat = document.getElementById('feature-chat');
    const featureVoice = document.getElementById('feature-voice');
    const featureQuiz = document.getElementById('feature-quiz');
    const featureFlashcard = document.getElementById('feature-flashcard');

    // ==================== TOAST SYSTEM ====================
    const toastContainer = document.getElementById('toast-container');

    function showToast(message, type = 'info', duration = 4000) {
        const icons = {
            success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
        toastContainer.appendChild(toast);
        const timer = setTimeout(() => dismissToast(toast), duration);
        toast._timer = timer;
        return toast;
    }

    function dismissToast(toast) {
        if (toast._timer) clearTimeout(toast._timer);
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }

    // ==================== AMBIENT BACKGROUND ====================
    function initAmbient() {
        const canvas = document.getElementById('ambient-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        const dots = [];
        for (let i = 0; i < 35; i++) {
            dots.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: Math.random() * 1.5 + 0.5,
                dx: (Math.random() - 0.5) * 0.25,
                dy: (Math.random() - 0.5) * 0.25,
                hue: Math.random() > 0.5 ? 260 : 210,
                alpha: Math.random() * 0.2 + 0.05,
            });
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw gradient orbs
            const orb1 = ctx.createRadialGradient(
                canvas.width * 0.2, canvas.height * 0.4, 0,
                canvas.width * 0.2, canvas.height * 0.4, canvas.width * 0.35
            );
            orb1.addColorStop(0, 'rgba(124, 77, 255, 0.06)');
            orb1.addColorStop(1, 'transparent');
            ctx.fillStyle = orb1;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const orb2 = ctx.createRadialGradient(
                canvas.width * 0.8, canvas.height * 0.3, 0,
                canvas.width * 0.8, canvas.height * 0.3, canvas.width * 0.3
            );
            orb2.addColorStop(0, 'rgba(64, 196, 255, 0.04)');
            orb2.addColorStop(1, 'transparent');
            ctx.fillStyle = orb2;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw dots and connections
            dots.forEach(d => {
                d.x += d.dx;
                d.y += d.dy;
                if (d.x < 0 || d.x > canvas.width) d.dx *= -1;
                if (d.y < 0 || d.y > canvas.height) d.dy *= -1;

                ctx.beginPath();
                ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${d.hue}, 70%, 65%, ${d.alpha})`;
                ctx.fill();
            });

            for (let i = 0; i < dots.length; i++) {
                for (let j = i + 1; j < dots.length; j++) {
                    const dx = dots[i].x - dots[j].x;
                    const dy = dots[i].y - dots[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 160) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(124, 77, 255, ${0.025 * (1 - dist / 160)})`;
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(dots[i].x, dots[i].y);
                        ctx.lineTo(dots[j].x, dots[j].y);
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(animate);
        }
        animate();
    }
    initAmbient();

    // ==================== MARKDOWN CONFIG ====================
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
    }

    // ==================== UTILITY ====================
    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function sanitizeHTML(html) {
        if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(html);
        return html;
    }

    function highlightCodeBlocks(container) {
        if (typeof hljs !== 'undefined') {
            container.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        }
        container.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.copy-code-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn';
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            btn.addEventListener('click', () => {
                const code = pre.querySelector('code');
                const text = code ? code.textContent : pre.textContent;
                navigator.clipboard.writeText(text).then(() => {
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
                        btn.classList.remove('copied');
                    }, 2000);
                });
            });
            pre.style.position = 'relative';
            pre.appendChild(btn);
        });
    }

    // ==================== VIEW MANAGEMENT ====================
    function showView(view) {
        [welcomeView, chatView, quizView, flashcardView].forEach(v => v.classList.add('hidden'));
        view.classList.remove('hidden');
        // Close sidebar on mobile
        sidebar.classList.remove('open');
    }

    function showChatView() {
        showView(chatView);
        if (!isCallMode) chatInput.focus();
    }

    function showWelcomeView() {
        showView(welcomeView);
    }

    // ==================== SIDEBAR TOGGLE ====================
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Close sidebar on click outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 900 && sidebar.classList.contains('open')) {
            if (!sidebar.contains(e.target) && e.target !== sidebarToggle) {
                sidebar.classList.remove('open');
            }
        }
    });

    // ==================== NAVIGATION ====================
    brandLogo.addEventListener('click', () => {
        if (isCallMode) return;
        resetChat();
        showWelcomeView();
    });

    newChatBtn.addEventListener('click', () => {
        resetChat();
        showChatView();
        showToast('New conversation started', 'success', 2500);
    });

    featureChat.addEventListener('click', () => showChatView());
    featureVoice.addEventListener('click', () => {
        showChatView();
        startCallMode();
    });
    featureQuiz.addEventListener('click', () => {
        if (currentContextId) startQuiz();
        else showToast('Upload your notes first to generate a quiz', 'info');
    });
    featureFlashcard.addEventListener('click', () => {
        if (currentContextId) startFlashcards();
        else showToast('Upload your notes first to generate flashcards', 'info');
    });

    // ==================== INPUT HANDLING ====================
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        sendBtn.disabled = !(this.value.trim().length > 0 && !isGenerating);
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) chatForm.dispatchEvent(new Event('submit'));
        }
    });

    // ==================== FILE UPLOAD ====================
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    uploadDropzone.addEventListener('click', () => fileInput.click());
    attachBtn.addEventListener('click', () => fileInput.click());

    uploadDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadDropzone.classList.add('dragover');
    });
    uploadDropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadDropzone.classList.remove('dragover');
    });
    uploadDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadDropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFileUpload(fileInput.files[0]);
    });

    async function handleFileUpload(file) {
        if (file.type !== 'application/pdf') {
            showToast('Please upload a PDF file', 'error');
            return;
        }
        if (file.size > 25 * 1024 * 1024) {
            showToast('File too large. Maximum 25MB.', 'error');
            return;
        }

        // Show progress
        uploadDropzone.classList.add('hidden');
        uploadProgress.classList.remove('hidden');
        progressFill.style.width = '0%';
        progressText.textContent = 'Uploading...';

        // Animate progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 15, 85);
            progressFill.style.width = progress + '%';
        }, 300);

        const formData = new FormData();
        formData.append('file', file);

        try {
            progressText.textContent = 'Analyzing document...';
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            clearInterval(progressInterval);

            if (response.ok) {
                progressFill.style.width = '100%';
                progressText.textContent = 'Indexing complete!';

                currentContextId = data.context_id;

                // Update sidebar doc info
                docName.textContent = data.filename;
                docMeta.textContent = `${data.pages} pages · ${data.chunks} chunks`;
                activeDoc.classList.remove('hidden');

                // Enable tools
                enableTools();

                setTimeout(() => {
                    uploadProgress.classList.add('hidden');
                    uploadDropzone.classList.remove('hidden');
                }, 800);

                // Switch to chat
                showChatView();
                addMessage('assistant', `📚 I've analyzed **${data.filename}** (${data.pages} pages, ${data.chunks} chunks indexed for smart retrieval).\n\nYou can now:\n- **Ask questions** about your notes\n- Request **cross-questions** to test yourself\n- **Generate a quiz** or **flashcards** from the sidebar\n- Start a **voice conversation**\n\nWhat would you like to study? 📖`, false);
                showToast(`${data.filename} ready for study!`, 'success');
            } else {
                throw new Error(data.detail || 'Upload failed');
            }
        } catch (error) {
            clearInterval(progressInterval);
            uploadProgress.classList.add('hidden');
            uploadDropzone.classList.remove('hidden');
            showToast('Upload failed: ' + error.message, 'error');
        } finally {
            fileInput.value = '';
        }
    }

    function enableTools() {
        toolSummary.disabled = false;
        toolQuiz.disabled = false;
        toolFlashcards.disabled = false;
    }

    function disableTools() {
        toolSummary.disabled = true;
        toolQuiz.disabled = true;
        toolFlashcards.disabled = true;
    }

    docRemove.addEventListener('click', () => {
        currentContextId = null;
        activeDoc.classList.add('hidden');
        disableTools();
        showToast('Document removed', 'info', 2500);
        if (!chatView.classList.contains('hidden')) {
            addMessage('assistant', 'I\'ve removed the document context. Upload another PDF to continue studying!', false);
        }
    });

    // ==================== TOOL BUTTONS ====================
    toolSummary.addEventListener('click', async () => {
        if (!currentContextId) return;
        showChatView();
        addMessage('user', 'Generate a summary of my notes');
        chatHistory.push({ role: 'user', content: 'Generate a summary of my notes' });

        const loadingMsg = addLoadingIndicator();
        try {
            const res = await fetch('/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context_id: currentContextId, detail_level: 'medium' })
            });
            const data = await res.json();
            loadingMsg.remove();

            if (data.summary) {
                addMessage('assistant', data.summary);
                chatHistory.push({ role: 'assistant', content: data.summary });
            } else {
                throw new Error('No summary returned');
            }
        } catch (e) {
            loadingMsg.remove();
            addMessage('assistant', '**Error:** Could not generate summary. Please try again.', false);
            showToast('Summary generation failed', 'error');
        }
    });

    toolQuiz.addEventListener('click', () => {
        if (currentContextId) startQuiz();
    });

    toolFlashcards.addEventListener('click', () => {
        if (currentContextId) startFlashcards();
    });

    toolVoice.addEventListener('click', () => {
        showChatView();
        startCallMode();
    });

    // ==================== CHAT LOGIC ====================
    function appendMessageDOM(role) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;

        const avatarSvg = role === 'assistant'
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

        const avatarClass = role === 'assistant' ? 'assistant-avatar' : 'user-avatar';
        const timeStr = formatTime(new Date());

        msgDiv.innerHTML = `
            <div class="msg-avatar ${avatarClass}">${avatarSvg}</div>
            <div class="msg-body">
                <div class="msg-content"></div>
                <span class="msg-time">${timeStr}</span>
            </div>
        `;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv.querySelector('.msg-content');
    }

    function addMessage(role, content, saveToHistory = true) {
        const contentDiv = appendMessageDOM(role);
        const rendered = marked.parse(content);
        contentDiv.innerHTML = sanitizeHTML(rendered);
        highlightCodeBlocks(contentDiv);
        if (saveToHistory) chatHistory.push({ role, content });
        return contentDiv;
    }

    function addLoadingIndicator() {
        const contentDiv = appendMessageDOM('assistant');
        contentDiv.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
        return contentDiv.parentElement.parentElement; // .message
    }

    function resetChat() {
        chatHistory = [];
        chatMessages.innerHTML = '';

        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'message assistant welcome-msg';
        welcomeMsg.innerHTML = `
            <div class="msg-avatar assistant-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
            </div>
            <div class="msg-body">
                <div class="msg-content">
                    <p>Hey! 👋 I'm <strong>StudyBuddy</strong>. ${currentContextId ? 'Ask me anything about your uploaded notes!' : 'Upload your notes to get started, or ask me any question!'}</p>
                </div>
                <span class="msg-time">${formatTime(new Date())}</span>
            </div>
        `;
        chatMessages.appendChild(welcomeMsg);
    }

    // ==================== CHAT SUBMISSION ====================
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text || isGenerating) return;
        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;
        await processUserMessage(text);
    });

    let lastFailedMessage = null;

    async function processUserMessage(text) {
        isGenerating = true;
        lastFailedMessage = text;
        addMessage('user', text);

        const requestPayload = {
            messages: chatHistory,
            context_id: currentContextId
        };

        const loadingMsgDiv = addLoadingIndicator();
        let assistantContentDiv = null;
        let fullResponse = "";
        let sentenceBuffer = "";

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) throw new Error("Chat request failed");
            loadingMsgDiv.remove();
            assistantContentDiv = appendMessageDOM('assistant');

            if (isCallMode) setCallState('speaking');

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let done = false;

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;

                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.substring(6);
                            if (dataStr === '[DONE]') { done = true; break; }

                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.content) {
                                    fullResponse += parsed.content;
                                    sentenceBuffer += parsed.content;

                                    if (isCallMode && activePipeline) {
                                        let result;
                                        while ((result = tryExtractChunk(sentenceBuffer)) !== null) {
                                            sentenceBuffer = result.remaining;
                                            if (result.chunk.length > 0) activePipeline.enqueue(result.chunk);
                                        }
                                    }

                                    const rendered = marked.parse(fullResponse);
                                    assistantContentDiv.innerHTML = sanitizeHTML(rendered);
                                    chatMessages.scrollTop = chatMessages.scrollHeight;
                                }
                                if (parsed.error) throw new Error(parsed.error);
                            } catch (e) {
                                if (e.message && !e.message.includes('JSON')) throw e;
                            }
                        }
                    }
                }
            }

            highlightCodeBlocks(assistantContentDiv);

            if (isCallMode && activePipeline && sentenceBuffer.trim().length > 0) {
                activePipeline.enqueue(sentenceBuffer.trim());
            }
            if (isCallMode && activePipeline) activePipeline.finish();

            chatHistory.push({ role: 'assistant', content: fullResponse });
            lastFailedMessage = null;

        } catch (error) {
            console.error(error);
            if (loadingMsgDiv.parentNode) loadingMsgDiv.remove();

            const errorDiv = addMessage('assistant', '**Error:** Could not connect to the AI. Please try again.', false);
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn';
            retryBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Retry';
            retryBtn.addEventListener('click', () => {
                retryBtn.closest('.message').remove();
                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
                processUserMessage(lastFailedMessage || text);
            });
            errorDiv.appendChild(retryBtn);
            showToast('Failed to get response', 'error');

            if (isCallMode) startListeningLoop();
        } finally {
            isGenerating = false;
            if (!isCallMode && chatInput.value.trim().length > 0) sendBtn.disabled = false;
        }
    }

    // ==================== QUIZ SYSTEM ====================
    async function startQuiz() {
        showView(quizView);
        quizContainer.innerHTML = '';
        quizContainer.appendChild(quizLoading);
        quizLoading.classList.remove('hidden');
        quizScore = 0;
        quizAnswered = 0;
        quizScoreEl.textContent = '';

        try {
            const res = await fetch('/api/quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context_id: currentContextId, num_questions: 5 })
            });

            if (!res.ok) throw new Error('Quiz generation failed');
            const data = await res.json();
            quizQuestions = data.questions || [];
            quizLoading.classList.add('hidden');

            if (quizQuestions.length === 0) {
                quizContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No questions generated. Try uploading more detailed notes.</p>';
                return;
            }

            renderQuizQuestions();
        } catch (e) {
            quizLoading.classList.add('hidden');
            quizContainer.innerHTML = '<p style="color: var(--error); text-align: center; padding: 40px;">Failed to generate quiz. Please try again.</p>';
            showToast('Quiz generation failed', 'error');
        }
    }

    function renderQuizQuestions() {
        quizQuestions.forEach((q, idx) => {
            const card = document.createElement('div');
            card.className = 'quiz-card';
            card.style.animationDelay = `${idx * 0.1}s`;

            const optionsHTML = q.options.map((opt, i) => {
                const letter = opt.charAt(0);
                return `<button class="quiz-option" data-letter="${letter}" data-qi="${idx}">
                    <span class="option-letter">${letter}</span>
                    <span>${opt.substring(3)}</span>
                </button>`;
            }).join('');

            card.innerHTML = `
                <div class="q-number">Question ${idx + 1} of ${quizQuestions.length}</div>
                <div class="q-text">${q.question}</div>
                <div class="quiz-options">${optionsHTML}</div>
            `;

            card.querySelectorAll('.quiz-option').forEach(btn => {
                btn.addEventListener('click', () => handleQuizAnswer(btn, idx));
            });

            quizContainer.appendChild(card);
        });
    }

    function handleQuizAnswer(btn, questionIdx) {
        const card = btn.closest('.quiz-card');
        const options = card.querySelectorAll('.quiz-option');
        const q = quizQuestions[questionIdx];
        const selected = btn.dataset.letter;
        const correct = q.correct;

        // Disable all options
        options.forEach(o => {
            o.classList.add('disabled');
            if (o.dataset.letter === correct) o.classList.add('correct');
        });

        if (selected === correct) {
            btn.classList.add('correct');
            quizScore++;
        } else {
            btn.classList.add('incorrect');
        }

        quizAnswered++;
        quizScoreEl.textContent = `${quizScore}/${quizAnswered}`;

        // Show explanation
        if (q.explanation) {
            const explDiv = document.createElement('div');
            explDiv.className = 'quiz-explanation';
            explDiv.innerHTML = `💡 <strong>Explanation:</strong> ${q.explanation}`;
            card.appendChild(explDiv);
        }

        // Check if quiz is complete
        if (quizAnswered === quizQuestions.length) {
            setTimeout(() => showQuizResults(), 600);
        }
    }

    function showQuizResults() {
        const pct = Math.round((quizScore / quizQuestions.length) * 100);
        let emoji, msg;
        if (pct >= 80) { emoji = '🎉'; msg = 'Excellent work! You know this material well!'; }
        else if (pct >= 60) { emoji = '💪'; msg = 'Good job! Keep reviewing the topics you missed.'; }
        else { emoji = '📖'; msg = 'Keep studying! Review your notes and try again.'; }

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'quiz-results';
        resultsDiv.innerHTML = `
            <div class="score-circle">
                <div class="score-number">${pct}%</div>
                <div class="score-label">Score</div>
            </div>
            <h3>${emoji} ${quizScore}/${quizQuestions.length} Correct</h3>
            <p>${msg}</p>
            <button class="quiz-retry-btn" id="quiz-retry">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Try Again
            </button>
        `;
        quizContainer.appendChild(resultsDiv);

        resultsDiv.querySelector('#quiz-retry').addEventListener('click', startQuiz);
    }

    quizBackBtn.addEventListener('click', () => showChatView());

    // ==================== FLASHCARD SYSTEM ====================
    async function startFlashcards() {
        showView(flashcardView);
        flashcardContainer.innerHTML = '';
        flashcardContainer.appendChild(flashcardLoading);
        flashcardLoading.classList.remove('hidden');
        currentCardIndex = 0;

        try {
            const res = await fetch('/api/flashcards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context_id: currentContextId, num_cards: 8 })
            });

            if (!res.ok) throw new Error('Flashcard generation failed');
            const data = await res.json();
            flashcards = data.flashcards || [];
            flashcardLoading.classList.add('hidden');

            if (flashcards.length === 0) {
                flashcardContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">No flashcards generated. Try more detailed notes.</p>';
                return;
            }

            renderFlashcards();
        } catch (e) {
            flashcardLoading.classList.add('hidden');
            flashcardContainer.innerHTML = '<p style="color: var(--error); text-align: center; padding: 40px;">Failed to generate flashcards. Please try again.</p>';
            showToast('Flashcard generation failed', 'error');
        }
    }

    function renderFlashcards() {
        flashcardContainer.innerHTML = '';
        const deck = document.createElement('div');
        deck.className = 'flashcard-deck';

        // Flashcard
        const card = document.createElement('div');
        card.className = 'flashcard';
        card.id = 'current-flashcard';
        card.innerHTML = getFlashcardHTML(currentCardIndex);
        card.addEventListener('click', () => card.classList.toggle('flipped'));
        deck.appendChild(card);

        // Navigation
        const nav = document.createElement('div');
        nav.className = 'flashcard-nav';
        nav.innerHTML = `
            <button class="flashcard-nav-btn" id="fc-prev" ${currentCardIndex === 0 ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="color: var(--text-secondary); font-size: 0.85rem;">${currentCardIndex + 1} / ${flashcards.length}</span>
            <button class="flashcard-nav-btn" id="fc-next" ${currentCardIndex === flashcards.length - 1 ? 'disabled' : ''}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        `;
        deck.appendChild(nav);

        // Hint
        const hint = document.createElement('div');
        hint.className = 'flashcard-hint';
        hint.textContent = 'Click card to flip';
        deck.appendChild(hint);

        flashcardContainer.appendChild(deck);

        flashcardCounter.textContent = `${currentCardIndex + 1} / ${flashcards.length}`;

        // Nav events
        document.getElementById('fc-prev').addEventListener('click', () => navigateFlashcard(-1));
        document.getElementById('fc-next').addEventListener('click', () => navigateFlashcard(1));
    }

    function getFlashcardHTML(index) {
        const fc = flashcards[index];
        return `
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div class="card-label">Question</div>
                    <div class="card-text">${fc.front}</div>
                    ${fc.category ? `<div class="flashcard-category">${fc.category}</div>` : ''}
                </div>
                <div class="flashcard-back">
                    <div class="card-label">Answer</div>
                    <div class="card-text">${fc.back}</div>
                </div>
            </div>
        `;
    }

    function navigateFlashcard(direction) {
        currentCardIndex += direction;
        if (currentCardIndex < 0) currentCardIndex = 0;
        if (currentCardIndex >= flashcards.length) currentCardIndex = flashcards.length - 1;
        renderFlashcards();
    }

    flashcardBackBtn.addEventListener('click', () => showChatView());

    // =====================================================================
    //  VOICE SYSTEM (VAD + Whisper + Streaming PCM TTS)
    // =====================================================================

    const CALL_STATES = {
        WAITING: 'waiting',
        LISTENING: 'listening',
        PROCESSING: 'processing',
        THINKING: 'thinking',
        SPEAKING: 'speaking',
    };

    function setCallState(state, subtitle) {
        const config = {
            [CALL_STATES.WAITING]: { title: 'Say something...', sub: "I'll respond when you pause", orbClass: 'waiting' },
            [CALL_STATES.LISTENING]: { title: 'Listening...', sub: "I'll respond when you pause", orbClass: 'listening' },
            [CALL_STATES.PROCESSING]: { title: 'Processing...', sub: 'Transcribing your audio...', orbClass: 'processing' },
            [CALL_STATES.THINKING]: { title: 'Thinking...', sub: subtitle || '', orbClass: 'processing' },
            [CALL_STATES.SPEAKING]: { title: 'Speaking...', sub: 'AI is responding', orbClass: 'speaking' },
        };

        const c = config[state];
        if (!c) return;
        callStatus.textContent = c.title;
        callSubtitle.textContent = subtitle || c.sub;
    }

    // ==================== VAD ====================
    class VoiceActivityDetector {
        constructor(stream, options = {}) {
            this.threshold = options.threshold || 0.012;
            this.silenceTimeout = options.silenceTimeout || 1500;
            this.minSpeechDuration = options.minSpeechDuration || 250;

            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.3;

            this.source = this.audioCtx.createMediaStreamSource(stream);
            this.source.connect(this.analyser);

            this.timeDomainData = new Float32Array(this.analyser.fftSize);
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

            this.isSpeaking = false;
            this.silenceStart = null;
            this.speechStart = null;

            this.onSpeechStart = options.onSpeechStart || (() => { });
            this.onSpeechEnd = options.onSpeechEnd || (() => { });
            this.onLevel = options.onLevel || (() => { });

            this.running = false;
            this._rafId = null;
        }

        start() {
            this.running = true;
            this._detect();
        }

        stop() {
            this.running = false;
            if (this._rafId) cancelAnimationFrame(this._rafId);
            try { this.audioCtx.close(); } catch (e) { }
        }

        _detect() {
            if (!this.running) return;
            this.analyser.getFloatTimeDomainData(this.timeDomainData);
            this.analyser.getByteFrequencyData(this.frequencyData);

            let sum = 0;
            for (let i = 0; i < this.timeDomainData.length; i++) {
                sum += this.timeDomainData[i] * this.timeDomainData[i];
            }
            const rms = Math.sqrt(sum / this.timeDomainData.length);
            this.onLevel(rms, this.frequencyData);

            const now = Date.now();
            if (rms > this.threshold) {
                if (!this.isSpeaking) {
                    this.isSpeaking = true;
                    this.speechStart = now;
                    this.onSpeechStart();
                }
                this.silenceStart = null;
            } else if (this.isSpeaking) {
                if (!this.silenceStart) {
                    this.silenceStart = now;
                } else if (now - this.silenceStart > this.silenceTimeout) {
                    if (this.speechStart && now - this.speechStart > this.minSpeechDuration) {
                        this.isSpeaking = false;
                        this.onSpeechEnd();
                    }
                }
            }

            this._rafId = requestAnimationFrame(() => this._detect());
        }
    }

    // ==================== STREAMING PCM PLAYER ====================
    class StreamingPCMPlayer {
        constructor() {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            this.nextStartTime = 0;
            this.isPlaying = false;
            this.scheduledSources = [];
            this.totalDuration = 0;
        }

        async playFromStream(response) {
            if (!response.ok) return;
            const reader = response.body.getReader();
            this.isPlaying = true;
            if (this.ctx.state === 'suspended') await this.ctx.resume();

            let leftover = new Uint8Array(0);
            while (true) {
                const { done, value } = await reader.read();
                if (done || !this.isPlaying) break;

                const combined = new Uint8Array(leftover.length + value.length);
                combined.set(leftover);
                combined.set(value, leftover.length);

                const completeBytesLen = Math.floor(combined.length / 2) * 2;
                if (completeBytesLen >= 4800) {
                    const chunk = combined.slice(0, completeBytesLen);
                    leftover = combined.slice(completeBytesLen);
                    this._scheduleChunk(chunk);
                } else {
                    leftover = combined;
                }
            }

            if (leftover.length >= 2) {
                const completeBytesLen = Math.floor(leftover.length / 2) * 2;
                if (completeBytesLen > 0) this._scheduleChunk(leftover.slice(0, completeBytesLen));
            }
        }

        _scheduleChunk(pcmBytes) {
            const alignedBuf = new ArrayBuffer(pcmBytes.length);
            new Uint8Array(alignedBuf).set(pcmBytes);
            const int16 = new Int16Array(alignedBuf);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

            const audioBuffer = this.ctx.createBuffer(1, float32.length, 24000);
            audioBuffer.getChannelData(0).set(float32);

            const source = this.ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.ctx.destination);

            const startTime = Math.max(this.ctx.currentTime + 0.01, this.nextStartTime);
            source.start(startTime);
            this.nextStartTime = startTime + audioBuffer.duration;
            this.totalDuration += audioBuffer.duration;
            this.scheduledSources.push(source);
        }

        waitUntilDone() {
            return new Promise(resolve => {
                const check = () => {
                    if (!this.isPlaying) { resolve(); return; }
                    if (this.ctx.currentTime >= this.nextStartTime - 0.05) resolve();
                    else setTimeout(check, 100);
                };
                check();
            });
        }

        stop() {
            this.isPlaying = false;
            this.scheduledSources.forEach(s => { try { s.stop(); } catch (e) { } });
            this.scheduledSources = [];
            this.nextStartTime = 0;
            this.totalDuration = 0;
            try { this.ctx.close(); } catch (e) { }
        }
    }

    // ==================== TTS PIPELINE ====================
    class TTSPipeline {
        constructor() {
            this.player = new StreamingPCMPlayer();
            this.queue = [];
            this.processing = false;
            this.aborted = false;
            this.finished = false;
            this.onComplete = null;
            this._resolveCompletion = null;
            this._completionPromise = null;
        }

        enqueue(text) {
            if (this.aborted) return;
            const fetchPromise = fetch('/api/tts/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            this.queue.push({ text, fetchPromise });
            if (!this.processing) this._processQueue();
        }

        finish() {
            this.finished = true;
            if (!this.processing && this.queue.length === 0) this._fireCompletion();
        }

        async _processQueue() {
            this.processing = true;
            while (this.queue.length > 0 && !this.aborted) {
                const item = this.queue.shift();
                try {
                    const response = await item.fetchPromise;
                    if (!this.aborted) await this.player.playFromStream(response);
                } catch (err) { console.error('TTS pipeline error:', err); }
            }
            this.processing = false;
            if (this.finished && !this.aborted) {
                await this.player.waitUntilDone();
                this._fireCompletion();
            }
        }

        _fireCompletion() {
            if (this.aborted) return;
            if (this.onComplete) { this.onComplete(); this.onComplete = null; }
            if (this._resolveCompletion) { this._resolveCompletion(); this._resolveCompletion = null; }
        }

        waitForCompletion() {
            if (this.finished && !this.processing && this.queue.length === 0) return Promise.resolve();
            if (!this._completionPromise) {
                this._completionPromise = new Promise(resolve => { this._resolveCompletion = resolve; });
            }
            return this._completionPromise;
        }

        abort() {
            this.aborted = true;
            this.queue = [];
            this.player.stop();
            if (this._resolveCompletion) this._resolveCompletion();
        }
    }

    // ==================== SENTENCE CHUNKING ====================
    function tryExtractChunk(buffer) {
        const sentenceMatch = buffer.match(/[.!?](\s|$)/);
        if (sentenceMatch) {
            const idx = sentenceMatch.index + 1;
            const chunk = buffer.substring(0, idx).trim();
            const remaining = buffer.substring(idx).trim();
            if (chunk.length > 0) return { chunk, remaining };
        }

        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx > 5) {
            const chunk = buffer.substring(0, newlineIdx).trim();
            const remaining = buffer.substring(newlineIdx + 1).trim();
            if (chunk.length > 0) return { chunk, remaining };
        }

        if (buffer.length > 80) {
            const clauseMatch = buffer.match(/[,;:]\s/);
            if (clauseMatch && clauseMatch.index > 12) {
                const idx = clauseMatch.index + 1;
                const chunk = buffer.substring(0, idx).trim();
                const remaining = buffer.substring(idx).trim();
                if (chunk.length > 0) return { chunk, remaining };
            }
        }

        if (buffer.length > 120) {
            const lastSpace = buffer.lastIndexOf(' ', 100);
            if (lastSpace > 20) {
                const chunk = buffer.substring(0, lastSpace).trim();
                const remaining = buffer.substring(lastSpace + 1).trim();
                if (chunk.length > 0) return { chunk, remaining };
            }
        }
        return null;
    }

    // ==================== WAVE VISUALIZATION ====================
    function updateWavesWithLevel(rms, frequencyData) {
        if (!callWaveBars.length) return;
        const bandSize = Math.floor(frequencyData.length / callWaveBars.length);
        callWaveBars.forEach((bar, i) => {
            let sum = 0;
            for (let j = 0; j < bandSize; j++) sum += frequencyData[i * bandSize + j];
            const avg = sum / bandSize;
            const height = Math.max(8, (avg / 255) * 50);
            bar.style.height = height + 'px';
        });
    }

    function resetWaveBars() {
        callWaveBars.forEach(bar => { bar.style.height = '8px'; });
    }

    // ==================== LIVE TRANSCRIPTION ====================
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    function updateLiveTranscript(finalText, interimText) {
        if (!liveTranscriptEl) return;
        let html = '';
        if (finalText) html += `<span class="transcript-final">${finalText}</span> `;
        if (interimText) {
            html += `<span class="transcript-interim">${interimText}</span>`;
            html += `<span class="transcript-caret"></span>`;
        }
        liveTranscriptEl.innerHTML = html;
        liveTranscriptEl.scrollTop = liveTranscriptEl.scrollHeight;
    }

    function clearLiveTranscript() {
        if (liveTranscriptEl) liveTranscriptEl.innerHTML = '';
    }

    function startSpeechRecognition() {
        if (!SpeechRecognitionAPI) return;
        stopSpeechRecognition();

        speechRecognition = new SpeechRecognitionAPI();
        speechRecognition.continuous = true;
        speechRecognition.interimResults = true;
        speechRecognition.maxAlternatives = 1;

        let finalTranscript = '';
        speechRecognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalTranscript += transcript;
                else interim += transcript;
            }
            updateLiveTranscript(finalTranscript, interim);
        };

        speechRecognition.onerror = (event) => {
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                console.warn('SpeechRecognition error:', event.error);
            }
        };

        speechRecognition.onend = () => {
            if (isCallMode && speechRecognition) {
                try { speechRecognition.start(); } catch (e) { }
            }
        };

        try { speechRecognition.start(); } catch (e) { }
    }

    function stopSpeechRecognition() {
        if (speechRecognition) {
            try { speechRecognition.abort(); } catch (e) { }
            speechRecognition = null;
        }
    }

    // ==================== VOICE CALL SYSTEM ====================
    voiceBtn.addEventListener('click', () => {
        if (!isCallMode) startCallMode();
    });

    endCallBtn.addEventListener('click', stopCallMode);

    async function startCallMode() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });

            isCallMode = true;
            callOverlay.classList.remove('hidden');

            mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                if (!isCallMode) return;
                await handleRecordingComplete();
            };

            activeVAD = new VoiceActivityDetector(micStream, {
                threshold: 0.012,
                silenceTimeout: 1500,
                minSpeechDuration: 250,
                onSpeechStart: () => { if (isCallMode) setCallState('listening'); },
                onSpeechEnd: () => {
                    if (!isCallMode) return;
                    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
                },
                onLevel: (rms, freqData) => {
                    if (isCallMode) updateWavesWithLevel(rms, freqData);
                },
            });

            showToast('Voice chat started — speak naturally', 'success', 2500);
            clearLiveTranscript();
            startListeningLoop();

        } catch (err) {
            console.error("Microphone access denied:", err);
            showToast('Microphone access is required for voice chat', 'error');
            stopCallMode();
        }
    }

    function startListeningLoop() {
        if (!isCallMode) return;
        setCallState('waiting');
        audioChunks = [];
        clearLiveTranscript();

        try {
            if (mediaRecorder && mediaRecorder.state !== 'recording') mediaRecorder.start();
        } catch (e) { }

        if (activeVAD) {
            activeVAD.isSpeaking = false;
            activeVAD.silenceStart = null;
            activeVAD.speechStart = null;
            if (!activeVAD.running) activeVAD.start();
        }

        startSpeechRecognition();
    }

    async function handleRecordingComplete() {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];

        if (audioBlob.size < 1000) { startListeningLoop(); return; }

        setCallState('processing');
        stopSpeechRecognition();

        const formData = new FormData();
        formData.append('audio', audioBlob, 'record.webm');

        try {
            const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.text && data.text.trim()) {
                setCallState('thinking', `"${data.text}"`);

                activePipeline = new TTSPipeline();
                activePipeline.onComplete = () => {
                    if (isCallMode) startListeningLoop();
                };

                await processUserMessage(data.text);

                if (activePipeline) await activePipeline.waitForCompletion();
            } else {
                startListeningLoop();
            }
        } catch (e) {
            console.error("Transcription error:", e);
            showToast('Transcription failed. Retrying...', 'error', 2000);
            setTimeout(() => startListeningLoop(), 1500);
        }
    }

    function stopCallMode() {
        isCallMode = false;
        callOverlay.classList.add('hidden');

        stopSpeechRecognition();
        clearLiveTranscript();

        if (activeVAD) { activeVAD.stop(); activeVAD = null; }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (e) { }
        }
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        if (activePipeline) { activePipeline.abort(); activePipeline = null; }

        resetWaveBars();
        showToast('Voice chat ended', 'info', 2000);
    }

    // ==================== INIT ====================
    const welcomeTimeEl = document.querySelector('.welcome-msg .msg-time');
    if (welcomeTimeEl) welcomeTimeEl.textContent = formatTime(new Date());

});
