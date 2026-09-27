const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const validator = require('validator');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME
});

// Initialize database
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        service VARCHAR(100) NOT NULL,
        message TEXT,
        source VARCHAR(50) DEFAULT 'website',
        status VARCHAR(50) DEFAULT 'novo',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agendamentos (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        date_preferred DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'pendente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
      CREATE INDEX IF NOT EXISTS idx_agendamentos_created_at ON agendamentos(created_at);
    `);
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST - Novo Lead (Formulário de Contato)
app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, phone, service, message } = req.body;

    // Validação
    if (!name || !email || !phone || !service) {
      return res.status(400).json({
        error: 'Campos obrigatórios faltando'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        error: 'Email inválido'
      });
    }

    if (!validator.isMobilePhone(phone, 'pt-BR')) {
      return res.status(400).json({
        error: 'Telefone inválido'
      });
    }

    // Sanitização
    const cleanName = validator.escape(name.trim());
    const cleanEmail = validator.normalizeEmail(email);
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanService = validator.escape(service.trim());
    const cleanMessage = message ? validator.escape(message.trim()) : null;

    const result = await pool.query(
      `INSERT INTO leads (name, email, phone, service, message, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at;`,
      [cleanName, cleanEmail, cleanPhone, cleanService, cleanMessage, 'website']
    );

    res.status(201).json({
      success: true,
      message: 'Lead capturado com sucesso',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });

    // Log
    console.log(`📌 Novo lead: ${cleanName} (${cleanEmail})`);

  } catch (error) {
    console.error('Erro ao criar lead:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// POST - Novo Agendamento
app.post('/api/agendamentos', async (req, res) => {
  try {
    const { name, email, phone, date } = req.body;

    // Validação
    if (!name || !email || !phone || !date) {
      return res.status(400).json({
        error: 'Campos obrigatórios faltando'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        error: 'Email inválido'
      });
    }

    // Validar data
    const agendaDate = new Date(date);
    if (agendaDate < new Date()) {
      return res.status(400).json({
        error: 'Data deve ser futura'
      });
    }

    // Sanitização
    const cleanName = validator.escape(name.trim());
    const cleanEmail = validator.normalizeEmail(email);
    const cleanPhone = phone.replace(/\D/g, '');

    const result = await pool.query(
      `INSERT INTO agendamentos (name, email, phone, date_preferred)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at;`,
      [cleanName, cleanEmail, cleanPhone, date]
    );

    res.status(201).json({
      success: true,
      message: 'Agendamento criado com sucesso',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });

    console.log(`📅 Novo agendamento: ${cleanName} (${cleanEmail})`);

  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// GET - Analytics (Dashboard)
app.get('/api/analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Total de leads
    const leadsCount = await pool.query(
      `SELECT COUNT(*) as total FROM leads WHERE created_at >= $1`,
      [startDate]
    );

    // Leads por serviço
    const leadsByService = await pool.query(
      `SELECT service, COUNT(*) as count
       FROM leads
       WHERE created_at >= $1
       GROUP BY service
       ORDER BY count DESC`,
      [startDate]
    );

    // Leads por status
    const leadsByStatus = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM leads
       WHERE created_at >= $1
       GROUP BY status`,
      [startDate]
    );

    // Agendamentos
    const agendamentosCount = await pool.query(
      `SELECT COUNT(*) as total FROM agendamentos WHERE created_at >= $1`,
      [startDate]
    );

    // Taxa de conversão (agendamentos vs leads)
    const conversionRate = leadsCount.rows[0].total > 0
      ? ((agendamentosCount.rows[0].total / leadsCount.rows[0].total) * 100).toFixed(2)
      : 0;

    // Leads por dia (últimos 7 dias)
    const leadsPerDay = await pool.query(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as count
       FROM leads
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    res.json({
      period_days: parseInt(days),
      summary: {
        total_leads: parseInt(leadsCount.rows[0].total),
        total_agendamentos: parseInt(agendamentosCount.rows[0].total),
        conversion_rate: parseFloat(conversionRate)
      },
      leads_by_service: leadsByService.rows,
      leads_by_status: leadsByStatus.rows,
      leads_per_day: leadsPerDay.rows
    });

  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    res.status(500).json({ error: 'Erro ao buscar analytics' });
  }
});

// GET - Listar Leads (com paginação)
app.get('/api/leads', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM leads';
    let countQuery = 'SELECT COUNT(*) as total FROM leads';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      countQuery += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);

    const leads = await pool.query(query, [...params, limit, offset]);
    const total = await pool.query(countQuery, params);

    res.json({
      data: leads.rows,
      pagination: {
        total: parseInt(total.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Erro ao listar leads:', error);
    res.status(500).json({ error: 'Erro ao listar leads' });
  }
});

// PATCH - Atualizar status do lead
app.patch('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status obrigatório' });
    }

    const result = await pool.query(
      `UPDATE leads
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *;`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }

    res.json({
      success: true,
      message: 'Lead atualizado',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar lead:', error);
    res.status(500).json({ error: 'Erro ao atualizar lead' });
  }
});

// DELETE - Deletar lead (soft delete)
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE leads
       SET status = 'deletado', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id;`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }

    res.json({ success: true, message: 'Lead deletado' });

  } catch (error) {
    console.error('Erro ao deletar lead:', error);
    res.status(500).json({ error: 'Erro ao deletar lead' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Start server
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`);
      console.log(`📊 Analytics: http://localhost:${PORT}/api/analytics`);
      console.log(`\n`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();

module.exports = app;
