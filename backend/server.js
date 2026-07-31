require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// 미들웨어
app.use(cors());
app.use(express.json());

// PostgreSQL 연결
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ============ API ============

// 1. 모든 업체 조회
app.get('/api/vendors', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vendors');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 업체 추가
app.post('/api/vendors', async (req, res) => {
  try {
    const { name, businessNumber, representative, program } = req.body;
    const result = await pool.query(
      'INSERT INTO vendors (name, businessNumber, representative, program) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, businessNumber, representative, program]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. 신고 현황 조회
app.get('/api/reportStatus/:vendorId/:year/:month', async (req, res) => {
  try {
    const { vendorId, year, month } = req.params;
    const result = await pool.query(
      'SELECT * FROM reportStatus WHERE vendorId = $1 AND year = $2 AND month = $3',
      [vendorId, year, month]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. 신고 현황 저장
app.post('/api/reportStatus', async (req, res) => {
  console.log('요청받음:', req.body);
  try {
    const { vendorId, month, year, reportType, completed } = req.body;
    
    const result = await pool.query(
      'INSERT INTO reportStatus (vendorId, month, year, reportType, completed) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [vendorId, month, year, reportType, completed]  // ← vendorIdNum 제거! vendorId 그대로 사용
    );
    
    console.log('저장됨:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('DB 에러:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. 신고 현황 업데이트
app.put('/api/reportStatus/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;
    const result = await pool.query(
      'UPDATE reportStatus SET completed = $1 WHERE id = $2 RETURNING *',
      [completed, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 서버 실행
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 서버 시작: http://localhost:${PORT}`);
});