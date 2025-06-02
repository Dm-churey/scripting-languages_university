async function apiRequest(url, method = 'GET', data = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.body = JSON.stringify(data);
    
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Ошибка API запроса (${url}):`, error);
    throw error;
  }
}

// Функция для переключения вкладок
function openTab(evt, tabName) {
  document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  
  document.getElementById(tabName).classList.add("active");
  evt.currentTarget.classList.add("active");
  
  if (tabName === 'rss-tab') loadRssSources();
  else if (tabName === 'keywords-tab') loadKeywords();
}

function createTableRow(data, columns, actions) {
  const row = document.createElement('tr');
  row.innerHTML = columns.map(col => `<td>${data[col]}</td>`).join('') + 
                 `<td class="actions">${actions.map(action => 
                   `<button class="btn-${action.type}" onclick="${action.onclick}">${action.text}</button>`
                 ).join('')}</td>`;
  return row;
}

async function loadRssSources() {
  try {
    const data = await apiRequest('/api/rss-sources');
    const tableBody = document.querySelector('#rss-table tbody');
    tableBody.innerHTML = '';
    
    data.forEach(source => {
      const row = createTableRow(
        { ...source, active: `<input type="checkbox" ${source.active ? 'checked' : ''} 
          onchange="updateRssActive(${source.id}, this.checked)">` },
        ['id', 'name', 'url', 'active'],
        [
          { type: 'edit', text: 'Редактировать', 
            onclick: `editRssSource(${source.id}, '${source.name}', '${source.url}')` },
          { type: 'delete', text: 'Удалить', 
            onclick: `deleteRssSource(${source.id})` }
        ]
      );
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Ошибка при загрузке RSS-лент:', error);
  }
}

async function loadKeywords() {
  try {
    const data = await apiRequest('/api/keywords');
    const tableBody = document.querySelector('#keywords-table tbody');
    tableBody.innerHTML = '';
    
    data.forEach(keyword => {
      const row = createTableRow(
        { ...keyword, active: `<input type="checkbox" ${keyword.active ? 'checked' : ''} 
          onchange="updateKeywordActive(${keyword.id}, this.checked)">` },
        ['id', 'word', 'active'],
        [
          { type: 'edit', text: 'Редактировать', 
            onclick: `editKeyword(${keyword.id}, '${keyword.word}')` },
          { type: 'delete', text: 'Удалить', 
            onclick: `deleteKeyword(${keyword.id})` }
        ]
      );
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error('Ошибка при загрузке ключевых слов:', error);
  }
}

async function updateRssActive(id, active) {
  try {
    await apiRequest(`/api/rss-sources/${id}`, 'PUT', { active });
  } catch (error) {
    console.error('Ошибка при обновлении RSS-ленты:', error);
  }
}

async function updateKeywordActive(id, active) {
  try {
    await apiRequest(`/api/keywords/${id}`, 'PUT', { active });
  } catch (error) {
    console.error('Ошибка при обновлении ключевого слова:', error);
  }
}

function editRssSource(id, name, url) {
  document.getElementById('rss-url').value = url;
  document.getElementById('rss-name').value = name;
  
  const form = document.getElementById('rss-form');
  form.onsubmit = async function(e) {
    e.preventDefault();
    try {
      const updatedUrl = document.getElementById('rss-url').value;
      const updatedName = document.getElementById('rss-name').value;
      
      await apiRequest(`/api/rss-sources/${id}`, 'PUT', { url: updatedUrl, name: updatedName });
      await loadRssSources();
      form.reset();
      form.onsubmit = addRssSource;
    } catch (error) {
      console.error('Ошибка при обновлении RSS-ленты:', error);
    }
  };
}

function editKeyword(id, word) {
  document.getElementById('keyword').value = word;
  
  const form = document.getElementById('keyword-form');
  form.onsubmit = async function(e) {
    e.preventDefault();
    try {
      const updatedWord = document.getElementById('keyword').value;
      await apiRequest(`/api/keywords/${id}`, 'PUT', { word: updatedWord });
      await loadKeywords();
      form.reset();
      form.onsubmit = addKeyword;
    } catch (error) {
      console.error('Ошибка при обновлении ключевого слова:', error);
    }
  };
}

async function deleteRssSource(id) {
  if (confirm('Вы уверены, что хотите удалить эту RSS-ленту?')) {
    try {
      await apiRequest(`/api/rss-sources/${id}`, 'DELETE');
      await loadRssSources();
    } catch (error) {
      console.error('Ошибка при удалении RSS-ленты:', error);
    }
  }
}

async function deleteKeyword(id) {
  if (confirm('Вы уверены, что хотите удалить это ключевое слово?')) {
    try {
      await apiRequest(`/api/keywords/${id}`, 'DELETE');
      await loadKeywords();
    } catch (error) {
      console.error('Ошибка при удалении ключевого слова:', error);
    }
  }
}

async function addRssSource(e) {
  e.preventDefault();
  try {
    const url = document.getElementById('rss-url').value;
    const name = document.getElementById('rss-name').value;
    
    await apiRequest('/api/rss-sources', 'POST', { url, name });
    await loadRssSources();
    document.getElementById('rss-form').reset();
  } catch (error) {
    console.error('Ошибка при добавлении RSS-ленты:', error);
  }
}

async function addKeyword(e) {
  e.preventDefault();
  try {
    const word = document.getElementById('keyword').value;
    await apiRequest('/api/keywords', 'POST', { word });
    await loadKeywords();
    document.getElementById('keyword-form').reset();
  } catch (error) {
    console.error('Ошибка при добавлении ключевого слова:', error);
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  // Инициализация обработчиков форм
  document.getElementById('rss-form').onsubmit = addRssSource;
  document.getElementById('keyword-form').onsubmit = addKeyword;
  
  // Автоматическое обновление списка новостей каждые 60 секунд
  setInterval(() => {
    if (document.getElementById('news-tab').classList.contains('active')) {
      window.location.reload();
    }
  }, 60000);
}); 