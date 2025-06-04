const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const Parser = require('rss-parser');
const cron = require('node-cron');
const path = require('path');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');

// Функция для логирования с временной меткой
function log(message, type = 'info') {
  const now = new Date();
  const timeString = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const dateString = now.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const logMessage = `[${dateString} ${timeString}] ${type.toUpperCase()}: ${message}`;
  
  switch (type) {
    case 'error': console.error(logMessage); break;
    case 'warn': console.warn(logMessage); break;
    default: console.log(logMessage);
  }
}

// Функция для вывода сообщений без временной метки
function print(message) {
  console.log(message);
}

const app = express();
const port = process.env.PORT || 3001;
const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Cache-Control': 'no-cache'
  },
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

/**
 * @swagger
 * /api-docs.json:
 *   get:
 *     summary: Получить OpenAPI спецификацию в формате JSON
 *     description: Возвращает полную документацию API в формате JSON
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: OpenAPI спецификация успешно получена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

const db = new sqlite3.Database('./rss_tracker.db', (err) => {
  if (err) {
    log('Ошибка при подключении к базе данных: ' + err.message, 'error');
    return;
  }
  log('Подключение к базе данных SQLite установлено');
  initializeDatabase()
    .then(() => {
      log('База данных инициализирована успешно');
      checkAllRssFeeds();
    })
    .catch(error => log('Ошибка при инициализации базы данных: ' + error, 'error'));
});

async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      try {
        db.run(`CREATE TABLE IF NOT EXISTS rss_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          active INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS keywords (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          word TEXT UNIQUE NOT NULL,
          active INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS news (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          content TEXT,
          link TEXT UNIQUE NOT NULL,
          source_id INTEGER,
          pub_date TEXT,
          found_date TEXT,
          keyword_id INTEGER,
          FOREIGN KEY (source_id) REFERENCES rss_sources (id),
          FOREIGN KEY (keyword_id) REFERENCES keywords (id)
        )`);

        db.get("SELECT COUNT(*) as count FROM rss_sources", (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row.count === 0) {
            const initialSources = [
              ["https://habr.com/ru/rss/best/daily/?fl=ru", "Хабр - лучшее за день"],
              ["https://www.opennet.ru/opennews/opennews_all_utf.rss", "OpenNet - Новости"],
              ["https://rss.dw.com/xml/rss-ru-all", "Deutsche Welle"],
              ["https://3dnews.ru/news/rss/", "3DNews - Новости"]
            ];

            const stmt = db.prepare("INSERT INTO rss_sources (url, name) VALUES (?, ?)");
            initialSources.forEach(([url, name]) => stmt.run(url, name));
            stmt.finalize();

            log('Добавлены начальные RSS-ленты');
          }

          db.get("SELECT COUNT(*) as count FROM keywords", (err, row) => {
            if (err) {
              reject(err);
              return;
            }

            if (row.count === 0) {
              const initialKeywords = [
                "технологии", "наука", "программирование",
                "интернет", "безопасность", "Linux"
              ];

              const stmt = db.prepare("INSERT INTO keywords (word) VALUES (?)");
              initialKeywords.forEach(word => stmt.run(word));
              stmt.finalize();

              log('Добавлены начальные ключевые слова');
            }
            resolve();
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function containsKeyword(text, keywords) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

async function getActiveKeywords() {
  return new Promise((resolve, reject) => {
    db.all("SELECT word FROM keywords WHERE active = 1", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(row => row.word));
    });
  });
}

async function getActiveRssSources() {
  return new Promise((resolve, reject) => {
    db.all("SELECT id, url, name FROM rss_sources WHERE active = 1", (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function fetchRssViaProxy(url) {
  try {
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
    log(`Используем прокси: ${proxyUrl}`);
    
    const response = await fetch(proxyUrl);
    const data = await response.json();
    
    if (data.status !== 'ok') {
      throw new Error(data.message || 'Неизвестная ошибка прокси');
    }
    
    log(`Прокси успешно получил данные для ${url}`);
    return {
      title: data.feed.title,
      description: data.feed.description,
      link: data.feed.link,
      items: data.items.map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        content: item.content,
        contentSnippet: item.description,
        guid: item.guid
      }))
    };
  } catch (error) {
    throw new Error(`Ошибка прокси-запроса: ${error.message}`);
  }
}

async function parseRssFeed(source, keywords) {
  try {
    let feed;
    let usedProxy = false;
    let newItemsFound = 0;
    
    try {
      feed = await parser.parseURL(source.url);
    } catch (directError) {
      try {
        feed = await fetchRssViaProxy(source.url);
        usedProxy = true;
      } catch (proxyError) {
        await db.run("UPDATE rss_sources SET active = 0 WHERE id = ?", [source.id]);
        log(`Источник "${source.name}" деактивирован из-за ошибок получения данных`, 'error');
        return;
      }
    }
    
    if (!feed?.items?.length) {
      log(`Источник "${source.name}" не содержит новостей`, 'warn');
      return;
    }
    
    for (const item of feed.items) {
      const existingNews = await new Promise((resolve, reject) => {
        db.get("SELECT id FROM news WHERE link = ?", [item.link], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingNews) continue;

      const title = item.title || '';
      const content = item.contentSnippet || item.content || '';
      const combinedText = `${title} ${content}`;
      
      for (const keyword of keywords) {
        if (containsKeyword(combinedText, [keyword])) {
          const keywordRow = await new Promise((resolve, reject) => {
            db.get("SELECT id FROM keywords WHERE word = ?", [keyword], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });

          if (!keywordRow) continue;

          const now = new Date().toISOString();
          const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : now;
          
          await new Promise((resolve, reject) => {
            db.run(
              "INSERT INTO news (title, content, link, source_id, pub_date, found_date, keyword_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [title, content, item.link, source.id, pubDate, now, keywordRow.id],
              function(err) {
                if (err) reject(err);
                else {
                  newItemsFound++;
                  log(`Новая новость: "${title}" (источник: ${source.name}, ключевое слово: "${keyword}")`);
                  resolve();
                }
              }
            );
          });
          break;
        }
      }
    }
    
    if (newItemsFound > 0) {
      log(`В источнике "${source.name}" найдено ${newItemsFound} новых новостей`);
    }
  } catch (error) {
    log(`Ошибка при проверке источника "${source.name}": ${error.message}`, 'error');
  }
}

async function checkAllRssFeeds() {
  try {
    const initialCount = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM news", (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    const [keywords, sources] = await Promise.all([
      getActiveKeywords(),
      getActiveRssSources()
    ]);
    
    await Promise.all(sources.map(source => parseRssFeed(source, keywords)));
    
    const finalCount = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM news", (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    const totalNewItems = finalCount - initialCount;
    
    if (totalNewItems > 0) {
      log(`Проверка завершена. Найдено ${totalNewItems} новых новостей`);
    } else {
      log('Проверка завершена. Новых новостей не найдено');
    }
  } catch (error) {
    log(`Ошибка при проверке RSS-лент: ${error.message}`, 'error');
  }
}

cron.schedule('*/20 * * * *', () => {
  log('Запуск планировщика проверки RSS-лент');
  checkAllRssFeeds();
});

// API эндпоинты

// Главная страница - список новостей
app.get('/', (req, res) => {
  db.all(`
    SELECT n.id, n.title, n.content, n.link, n.pub_date, n.found_date, 
           r.name as source_name, k.word as keyword
    FROM news n
    JOIN rss_sources r ON n.source_id = r.id
    JOIN keywords k ON n.keyword_id = k.id
    ORDER BY n.found_date DESC
  `, (err, rows) => {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при получении новостей' });
    }
    
    res.render('index', { news: rows });
  });
});

/**
 * @swagger
 * /api/news:
 *   get:
 *     summary: Получить список всех новостей
 *     description: Возвращает список всех новостей, отсортированных по дате обнаружения
 *     tags: [News]
 *     responses:
 *       200:
 *         description: Список новостей успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/News'
 *       500:
 *         description: Ошибка сервера
 */
app.get('/api/news', (req, res) => {
  db.all(`
    SELECT n.id, n.title, n.content, n.link, n.pub_date, n.found_date, 
           r.name as source_name, k.word as keyword
    FROM news n
    JOIN rss_sources r ON n.source_id = r.id
    JOIN keywords k ON n.keyword_id = k.id
    ORDER BY n.found_date DESC
  `, (err, rows) => {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при получении новостей' });
    }
    
    res.json(rows);
  });
});

/**
 * @swagger
 * /api/rss-sources:
 *   get:
 *     summary: Получить список всех RSS-лент
 *     description: Возвращает список всех RSS-лент, включая их статус активности
 *     tags: [RSS Sources]
 *     responses:
 *       200:
 *         description: Список RSS-лент успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RssSource'
 *       500:
 *         description: Ошибка сервера
 */
app.get('/api/rss-sources', (req, res) => {
  db.all("SELECT * FROM rss_sources", (err, rows) => {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при получении RSS-лент' });
    }
    
    res.json(rows);
  });
});

/**
 * @swagger
 * /api/rss-sources:
 *   post:
 *     summary: Добавить новую RSS-ленту
 *     description: Добавляет новую RSS-ленту в систему
 *     tags: [RSS Sources]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - name
 *             properties:
 *               url:
 *                 type: string
 *                 description: URL RSS-ленты
 *               name:
 *                 type: string
 *                 description: Название источника
 *     responses:
 *       200:
 *         description: RSS-лента успешно добавлена
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RssSource'
 *       400:
 *         description: Неверные параметры запроса
 *       500:
 *         description: Ошибка сервера
 */
app.post('/api/rss-sources', (req, res) => {
  const { url, name } = req.body;
  
  if (!url || !name) {
    return res.status(400).json({ error: 'URL и название обязательны' });
  }
  
  db.run("INSERT INTO rss_sources (url, name) VALUES (?, ?)", [url, name], function(err) {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при добавлении RSS-ленты' });
    }
    
    res.json({ id: this.lastID, url, name, active: 1 });
  });
});

/**
 * @swagger
 * /api/rss-sources/{id}:
 *   put:
 *     summary: Обновить RSS-ленту
 *     description: Обновляет информацию о существующей RSS-ленте
 *     tags: [RSS Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID RSS-ленты
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 description: URL RSS-ленты
 *               name:
 *                 type: string
 *                 description: Название источника
 *               active:
 *                 type: boolean
 *                 description: Статус активности
 *     responses:
 *       200:
 *         description: RSS-лента успешно обновлена
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RssSource'
 *       404:
 *         description: RSS-лента не найдена
 *       500:
 *         description: Ошибка сервера
 */
app.put('/api/rss-sources/:id', (req, res) => {
  const { id } = req.params;
  const { url, name, active } = req.body;
  
  db.run(
    "UPDATE rss_sources SET url = ?, name = ?, active = ? WHERE id = ?",
    [url, name, active ? 1 : 0, id],
    function(err) {
      if (err) {
        log(err.message, 'error');
        return res.status(500).json({ error: 'Ошибка при обновлении RSS-ленты' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'RSS-лента не найдена' });
      }
      
      res.json({ id: parseInt(id), url, name, active: active ? 1 : 0 });
    }
  );
});

/**
 * @swagger
 * /api/rss-sources/{id}:
 *   delete:
 *     summary: Удалить RSS-ленту
 *     description: Удаляет RSS-ленту из системы
 *     tags: [RSS Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID RSS-ленты
 *     responses:
 *       200:
 *         description: RSS-лента успешно удалена
 *       404:
 *         description: RSS-лента не найдена
 *       500:
 *         description: Ошибка сервера
 */
app.delete('/api/rss-sources/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM rss_sources WHERE id = ?", [id], function(err) {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при удалении RSS-ленты' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'RSS-лента не найдена' });
    }
    
    res.json({ success: true });
  });
});

/**
 * @swagger
 * /api/keywords:
 *   get:
 *     summary: Получить список всех ключевых слов
 *     description: Возвращает список всех ключевых слов, включая их статус активности
 *     tags: [Keywords]
 *     responses:
 *       200:
 *         description: Список ключевых слов успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Keyword'
 *       500:
 *         description: Ошибка сервера
 */
app.get('/api/keywords', (req, res) => {
  db.all("SELECT * FROM keywords", (err, rows) => {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при получении ключевых слов' });
    }
    
    res.json(rows);
  });
});

/**
 * @swagger
 * /api/keywords:
 *   post:
 *     summary: Добавить новое ключевое слово
 *     description: Добавляет новое ключевое слово в систему
 *     tags: [Keywords]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - word
 *             properties:
 *               word:
 *                 type: string
 *                 description: Ключевое слово
 *     responses:
 *       200:
 *         description: Ключевое слово успешно добавлено
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Keyword'
 *       400:
 *         description: Неверные параметры запроса
 *       500:
 *         description: Ошибка сервера
 */
app.post('/api/keywords', (req, res) => {
  const { word } = req.body;
  
  if (!word) {
    return res.status(400).json({ error: 'Ключевое слово обязательно' });
  }
  
  db.run("INSERT INTO keywords (word) VALUES (?)", [word], function(err) {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при добавлении ключевого слова' });
    }
    
    res.json({ id: this.lastID, word, active: 1 });
  });
});

/**
 * @swagger
 * /api/keywords/{id}:
 *   put:
 *     summary: Обновить ключевое слово
 *     description: Обновляет информацию о существующем ключевом слове
 *     tags: [Keywords]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID ключевого слова
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               word:
 *                 type: string
 *                 description: Ключевое слово
 *               active:
 *                 type: boolean
 *                 description: Статус активности
 *     responses:
 *       200:
 *         description: Ключевое слово успешно обновлено
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Keyword'
 *       404:
 *         description: Ключевое слово не найдено
 *       500:
 *         description: Ошибка сервера
 */
app.put('/api/keywords/:id', (req, res) => {
  const { id } = req.params;
  const { word, active } = req.body;
  
  db.run(
    "UPDATE keywords SET word = ?, active = ? WHERE id = ?",
    [word, active ? 1 : 0, id],
    function(err) {
      if (err) {
        log(err.message, 'error');
        return res.status(500).json({ error: 'Ошибка при обновлении ключевого слова' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Ключевое слово не найдено' });
      }
      
      res.json({ id: parseInt(id), word, active: active ? 1 : 0 });
    }
  );
});

/**
 * @swagger
 * /api/keywords/{id}:
 *   delete:
 *     summary: Удалить ключевое слово
 *     description: Удаляет ключевое слово из системы
 *     tags: [Keywords]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID ключевого слова
 *     responses:
 *       200:
 *         description: Ключевое слово успешно удалено
 *       404:
 *         description: Ключевое слово не найдено
 *       500:
 *         description: Ошибка сервера
 */
app.delete('/api/keywords/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM keywords WHERE id = ?", [id], function(err) {
    if (err) {
      log(err.message, 'error');
      return res.status(500).json({ error: 'Ошибка при удалении ключевого слова' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Ключевое слово не найдено' });
    }
    
    res.json({ success: true });
  });
});

// Запуск сервера
app.listen(port, () => {
  const localUrl = `http://localhost:${port}`;
  print('Сервер запущен на порту ' + port);
  print('Откройте приложение по адресу: ' + localUrl);
  console.log('\x1b[36m%s\x1b[0m', `🌐 ${localUrl}`);
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) log(err.message, 'error');
    log('Соединение с базой данных закрыто');
    process.exit(0);
  });
});