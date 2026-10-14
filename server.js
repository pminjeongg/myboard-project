require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const dns = require('dns');
const app = express();

dns.setServers(['8.8.8.8', '1.1.1.1']);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("DB 연결 성공"))
    .catch((err) => console.log("DB 연결 실패:", err));

// createdAt / updatedAt 자동 생성
const boardSchema = new mongoose.Schema({
    title: String,
    writer: String,
    content: String
}, { timestamps: true });

const Board = mongoose.model('Board', boardSchema);

app.use(express.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(__dirname, 'css')));

const PAGE_SIZE = 10;

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 날짜,시간
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 작성자별 아바타 색상 (이름을 해시해서 고정된 파스텔 색을 배정)
const AVATAR_COLORS = ['#4F8FE0', '#F2A488', '#8FD1BE', '#F5CB5C', '#B79CE0'];
function avatarColor(name) {
    const str = String(name || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// 목록
function renderList(list, page, totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const count = `<div class="board-count">총 <b>${totalCount}</b>개의 게시물</div>`;

    if (totalCount === 0) {
        return count + `<div class="empty">등록된 글이 없습니다.</div>`;
    }

    let rows = '';
    list.forEach((item, i) => {
        // 최신 글이 위
        const no = totalCount - ((page - 1) * PAGE_SIZE + i);
        const writer = escapeHtml(item.writer);
        const initial = escapeHtml(String(item.writer || '?').trim().charAt(0) || '?');
        const color = avatarColor(item.writer);
        rows += `
        <div class="post-group">
            <div class="post-summary" onclick="toggleContent(this)">
                <span class="post-no">${no}</span>
                <span class="post-title">${escapeHtml(item.title)}</span>
                <span class="post-writer"><span class="avatar" style="background:${color}">${initial}</span>${writer}</span>
                <span class="post-date">${formatDate(item.createdAt)}</span>
            </div>
            <div class="post-detail">
                <div class="post-content">${escapeHtml(item.content)}</div>
                <div class="post-actions">
                    <button onclick="event.stopPropagation(); deletePost(this, '${item._id}')">삭제</button>
                </div>
            </div>
        </div>`;
    });

    // 페이지이동
    let pager = `<div class="pagination">`;
    pager += `<button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">이전</button>`;
    for (let p = 1; p <= totalPages; p++) {
        pager += `<button class="${p === page ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
    }
    pager += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">다음</button>`;
    pager += `</div>`;

    return count + rows + pager;
}

const TETRIS_DIR = path.join(__dirname, 'games', 'tetris');
app.use('/tetris', express.static(TETRIS_DIR));

app.get('/', (req, res) => {
    res.redirect('/home');
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/board', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'board.html'));
});

app.get('/tetris', (req, res) => {
    res.sendFile(path.join(TETRIS_DIR, 'index.html'));
});

app.post('/post', async (req, res) => {
    try {
        await Board.create({
            title: req.body.title,
            writer: req.body.writer,
            content: req.body.content
        });
        res.redirect('/board?tab=list');
    } catch (err) {
        console.log('등록 에러:', err);
        res.status(500).send('등록 중 오류가 발생했습니다.');
    }
});

app.delete('/post/:id', async (req, res) => {
    try {
        await Board.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.log('삭제 에러:', err);
        res.status(500).json({ success: false });
    }
});

app.get('/list', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const totalCount = await Board.countDocuments();
        const list = await Board.find()
            .sort({ createdAt: -1 })
            .skip((page - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE);
        res.send(renderList(list, page, totalCount));
    } catch (err) {
        console.log('목록 조회 에러:', err);
        res.status(500).send('목록을 불러오는 중 오류가 발생했습니다.');
    }
});

app.get('/search', async (req, res) => {
    try {
        const keyword = req.query.keyword || '';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const filter = {
            $or: [
                { title: { $regex: keyword, $options: 'i' } },
                { writer: { $regex: keyword, $options: 'i' } },
                { content: { $regex: keyword, $options: 'i' } }
            ]
        };
        const totalCount = await Board.countDocuments(filter);
        const list = await Board.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE);
        res.send(renderList(list, page, totalCount));
    } catch (err) {
        console.log('검색 에러:', err);
        res.status(500).send('검색 중 오류가 발생했습니다.');
    }
});

app.listen(3000, () => {
    console.log("서버 실행");
});