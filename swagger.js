const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RSS News Tracker API',
      version: '1.0.0',
      description: 'API для отслеживания новостей из RSS-лент с фильтрацией по ключевым словам',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        News: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Уникальный идентификатор новости' },
            title: { type: 'string', description: 'Заголовок новости' },
            content: { type: 'string', description: 'Содержание новости' },
            link: { type: 'string', description: 'Ссылка на оригинальную новость' },
            pub_date: { type: 'string', format: 'date-time', description: 'Дата публикации новости' },
            found_date: { type: 'string', format: 'date-time', description: 'Дата обнаружения новости' },
            source_name: { type: 'string', description: 'Название источника новости' },
            keyword: { type: 'string', description: 'Ключевое слово, по которому найдена новость' }
          }
        },
        RssSource: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Уникальный идентификатор источника' },
            url: { type: 'string', description: 'URL RSS-ленты' },
            name: { type: 'string', description: 'Название источника' },
            active: { type: 'integer', description: 'Статус активности (1 - активен, 0 - неактивен)' }
          }
        },
        Keyword: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Уникальный идентификатор ключевого слова' },
            word: { type: 'string', description: 'Ключевое слово' },
            active: { type: 'integer', description: 'Статус активности (1 - активно, 0 - неактивно)' }
          }
        }
      }
    }
  },
  apis: ['./app.js'], // Путь к файлу с API endpoints
};

const specs = swaggerJsdoc(options);

module.exports = specs; 