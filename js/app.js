// Game state
var state = {
  startArticle: null,
  endArticle: null,
  currentArticle: null,
  path: [],
  clicks: 0,
  timerInterval: null,
  startTime: null,
  playing: false,
  difficulty: 'easy',
  currentTocSections: [],
  mode: 'solo',
  partySnapshot: null,
  partyRefreshPending: false,
  partyClosed: false,
};

function partyError(message, targetId) {
  document.getElementById(targetId || 'partyError').textContent = message || '';
}

function openPartySetup() {
  partyError('');
  document.getElementById('partySetup').classList.remove('hidden');
}

function closePartySetup() {
  document.getElementById('partySetup').classList.add('hidden');
}

function getPartyName() {
  return document.getElementById('partyName').value.trim();
}

async function createParty() {
  var name = getPartyName();
  if (!name) return partyError('Informe seu nome.');
  partyError('Criando opções de voto...');
  try {
    await ensurePartyIdentity();
    var articles = await getRandomArticles(6);
    var options = articles.map(function(article, index) {
      return { kind: index < 3 ? 'start' : 'target', position: (index % 3) + 1, title: article.title };
    });
    var party = await callPartyRpc('create_party', { p_display_name: name, p_options: options });
    closePartySetup();
    await enterPartyLobby(party.id);
  } catch (error) {
    partyError(error.message || 'Não foi possível criar a party.');
  }
}

async function joinParty() {
  var name = getPartyName();
  var code = document.getElementById('partyCode').value.trim().toUpperCase();
  if (!name || !code) return partyError('Informe seu nome e o código da party.');
  partyError('Entrando na party...');
  try {
    await ensurePartyIdentity();
    var party = await callPartyRpc('join_party', { p_code: code, p_display_name: name });
    closePartySetup();
    await enterPartyLobby(party.id);
  } catch (error) {
    partyError(error.message || 'Não foi possível entrar na party.');
  }
}

async function enterPartyLobby(partyId) {
  state.mode = 'party';
  state.partyClosed = false;
  document.getElementById('partyLobby').classList.remove('hidden');
  subscribeToParty(partyId, schedulePartyRefresh);
  await refreshParty(partyId);
}

function schedulePartyRefresh() {
  if (state.partyRefreshPending || !state.partySnapshot) return;
  state.partyRefreshPending = true;
  setTimeout(function() {
    state.partyRefreshPending = false;
    refreshParty(state.partySnapshot.party.id).catch(function(error) { console.error(error); });
  }, 150);
}

async function refreshParty(partyId) {
  var snapshot = await getPartySnapshot(partyId);
  state.partySnapshot = snapshot;
  if (snapshot.party.status === 'playing' || snapshot.party.status === 'finishing' || snapshot.party.status === 'finished') {
    launchPartyGame(snapshot);
  } else {
    renderPartyLobby(snapshot);
  }
  updatePartyPanel();
}

function renderPartyLobby(snapshot) {
  document.getElementById('lobbyCode').textContent = snapshot.party.code;
  document.getElementById('lobbyMemberCount').textContent = '(' + snapshot.members.length + '/10)';
  document.getElementById('lobbyStatus').textContent = 'Cada participante vota em um início e um alvo.';
  var members = document.getElementById('lobbyMembers');
  members.innerHTML = '';
  snapshot.members.forEach(function(member) {
    var item = document.createElement('li');
    item.textContent = member.display_name + (member.user_id === partyStore.user.id ? ' (você)' : '');
    members.appendChild(item);
  });
  var votes = snapshot.votes;
  var voteGrid = document.getElementById('voteGrid');
  voteGrid.innerHTML = '';
  ['start', 'target'].forEach(function(kind) {
    var group = document.createElement('section');
    group.className = 'vote-group';
    group.innerHTML = '<h2>' + (kind === 'start' ? 'Artigo inicial' : 'Artigo alvo') + '</h2>';
    snapshot.options.filter(function(option) { return option.kind === kind; }).forEach(function(option) {
      var count = votes.filter(function(vote) { return vote.option_id === option.id; }).length;
      var mine = votes.find(function(vote) { return vote.user_id === partyStore.user.id && vote.kind === kind; });
      var button = document.createElement('button');
      button.className = 'vote-option' + (mine && mine.option_id === option.id ? ' selected' : '');
      button.innerHTML = '<span></span><span class="vote-count">' + count + ' voto' + (count === 1 ? '' : 's') + '</span>';
      button.firstChild.textContent = option.title;
      button.onclick = (function(optionId, voteKind) {
        return function() { castPartyVote(snapshot.party.id, voteKind, optionId); };
      })(option.id, kind);
      group.appendChild(button);
    });
    voteGrid.appendChild(group);
  });
  var canStart = snapshot.party.host_id === partyStore.user.id;
  var startButton = document.getElementById('startPartyButton');
  startButton.classList.toggle('hidden', !canStart);
  startButton.disabled = !canStart;
}

async function castPartyVote(partyId, kind, optionId) {
  try {
    await callPartyRpc('cast_party_vote', { p_party_id: partyId, p_kind: kind, p_option_id: optionId });
    await refreshParty(partyId);
  } catch (error) {
    partyError(error.message || 'Não foi possível registrar o voto.', 'lobbyError');
  }
}

async function startPartyGame() {
  try {
    await callPartyRpc('start_party', { p_party_id: state.partySnapshot.party.id });
    await refreshParty(state.partySnapshot.party.id);
  } catch (error) {
    partyError(error.message || 'Não foi possível iniciar a partida.', 'lobbyError');
  }
}

function launchPartyGame(snapshot) {
  if (!snapshot.party.selected_start || !snapshot.party.selected_target) return;
  document.getElementById('partyLobby').classList.add('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('appContainer').style.display = 'flex';
  var mine = snapshot.members.find(function(member) { return member.user_id === partyStore.user.id; });
  var shouldReload = state.startArticle !== snapshot.party.selected_start || state.endArticle !== snapshot.party.selected_target;
  state.startArticle = snapshot.party.selected_start;
  state.endArticle = snapshot.party.selected_target;
  state.clicks = mine ? mine.clicks : 0;
  state.path = mine && Array.isArray(mine.path) && mine.path.length ? mine.path : [];
  state.playing = snapshot.party.status !== 'finished' && (!mine || mine.status === 'active');
  document.getElementById('startTitle').textContent = state.startArticle;
  document.getElementById('endTitle').textContent = state.endArticle;
  document.getElementById('clickCount').textContent = state.clicks;
  document.getElementById('panelClicks').textContent = state.clicks;
  if (!state.timerInterval) startTimer();
  if (shouldReload) {
    state.currentArticle = null;
    loadArticle(state.path.length ? state.path[state.path.length - 1] : state.startArticle, state.path.length === 0);
  }
}

function setDifficulty(diff) {
  state.difficulty = diff;
  document.querySelectorAll('.diff-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.diff === diff);
  });
}

function showStartScreen() {
  stopTimer();
  document.getElementById('startScreen').classList.remove('hidden');
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('victoryOverlay').classList.add('hidden');
}

// Tooltip
function showTooltip(element, title, summary) {
  var tooltip = document.getElementById('wikiTooltip');
  document.getElementById('tooltipTitle').textContent = title;
  document.getElementById('tooltipDesc').textContent = summary.description || 'Carregando...';

  var rect = element.getBoundingClientRect();
  var left = rect.left + rect.width / 2 - 180;
  var top = rect.bottom + 8;

  if (left < 10) left = 10;
  if (left + 360 > window.innerWidth) left = window.innerWidth - 370;
  if (top + 150 > window.innerHeight) top = rect.top - 8 - 150;

  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  document.getElementById('wikiTooltip').classList.remove('visible');
}

function attachTooltipEvents(element, title) {
  var summaryCache = null;
  element.addEventListener('mouseenter', function() {
    if (!summaryCache) {
      summaryCache = { description: 'Carregando...' };
      getArticleSummary(title).then(function(result) {
        summaryCache = result || { description: 'Não foi possível carregar a descrição.' };
        if (tooltip._visible) {
          document.getElementById('tooltipDesc').textContent = summaryCache.description;
        }
      });
    }
    showTooltip(element, title, summaryCache);
  });
  element.addEventListener('mouseleave', hideTooltip);
}

// Timer
function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.startTime = state.mode === 'party' && state.partySnapshot && state.partySnapshot.party.started_at
    ? new Date(state.partySnapshot.party.started_at).getTime()
    : Date.now();
  state.timerInterval = setInterval(function() {
    var elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    var min = Math.floor(elapsed / 60);
    var sec = elapsed % 60;
    document.getElementById('timer').textContent = min + ':' + sec.toString().padStart(2, '0');
    document.getElementById('panelTimer').textContent = min + ':' + sec.toString().padStart(2, '0');
    updatePartyFinishPanel();
  }, 200);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function getElapsedTime() {
  if (!state.startTime) return '0:00';
  var elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  var min = Math.floor(elapsed / 60);
  var sec = elapsed % 60;
  return min + ':' + sec.toString().padStart(2, '0');
}

// History tracker
function updateHistory() {
  var container = document.getElementById('historyBar');
  container.innerHTML = '';

  var header = document.createElement('div');
  header.className = 'history-header';
  header.innerHTML = '<span class="history-icon">📜</span><span>Seu percurso</span><span class="history-count">(' + state.path.length + ' página' + (state.path.length !== 1 ? 's' : '') + ')</span>';
  container.appendChild(header);

  var list = document.createElement('div');
  list.className = 'history-list';

  state.path.forEach(function(title, i) {
    if (i > 0) {
      var sep = document.createElement('span');
      sep.className = 'history-sep';
      sep.textContent = '→';
      list.appendChild(sep);
    }

    var item = document.createElement('span');
    item.className = 'history-item';

    var num = document.createElement('span');
    num.className = 'history-num' + (i === state.path.length - 1 ? ' current' : '');
    num.textContent = i + 1;

    var link = document.createElement('span');
    var isCurrent = i === state.path.length - 1;
    link.className = 'history-link' + (isCurrent ? ' current' : '');
    link.textContent = title;

    if (!isCurrent) {
      link.onclick = (function(t, idx) {
        return function() { navigateToArticle(t, idx); };
      })(title, i);
    }

    item.appendChild(num);
    item.appendChild(link);
    list.appendChild(item);
  });

  container.appendChild(list);

  var routeList = document.getElementById('routeList');
  routeList.innerHTML = '';
  state.path.forEach(function(title, i) {
    var item = document.createElement('li');
    var isCurrent = i === state.path.length - 1;
    item.className = isCurrent ? 'current' : '';
    item.textContent = title;
    if (!isCurrent) {
      item.onclick = (function(t, index) {
        return function() { navigateToArticle(t, index); };
      })(title, i);
    }
    routeList.appendChild(item);
  });
}

function updatePartyPanel() {
  var list = document.getElementById('participantList');
  if (state.mode !== 'party' || !state.partySnapshot) {
    list.innerHTML = '<li class="panel-muted">Você</li>';
    return;
  }
  list.innerHTML = '';
  var placements = ['—', '1º lugar', '2º lugar', '3º lugar', '4º lugar'];
  state.partySnapshot.members.forEach(function(member) {
    var item = document.createElement('li');
    var name = document.createElement('span');
    name.textContent = member.display_name + (member.user_id === partyStore.user.id ? ' (você)' : '');
    if (member.user_id === partyStore.user.id) name.className = 'me';
    var status = document.createElement('span');
    status.className = 'panel-muted';
    status.textContent = member.placement ? placements[member.placement] : member.clicks + ' cliques';
    item.appendChild(name);
    item.appendChild(status);
    list.appendChild(item);
  });
  updatePartyFinishPanel();
}

function updatePartyFinishPanel() {
  var panel = document.getElementById('finishPanel');
  if (state.mode !== 'party' || !state.partySnapshot || state.partySnapshot.party.status !== 'finishing') {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  var deadline = new Date(state.partySnapshot.party.finish_deadline).getTime();
  var remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  document.getElementById('finishCountdown').textContent = remaining > 0
    ? 'A partida termina em ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0')
    : 'Encerrando partida...';
  if (remaining === 0 && !state.partyClosed) {
    state.partyClosed = true;
    callPartyRpc('close_party', { p_party_id: state.partySnapshot.party.id }).catch(function(error) { console.error(error); });
  }
}

async function syncPartyProgress() {
  if (state.mode !== 'party' || !state.partySnapshot || !state.playing) return;
  try {
    await callPartyRpc('record_party_jump', { p_party_id: state.partySnapshot.party.id, p_path: state.path });
  } catch (error) {
    console.error('Não foi possível sincronizar o salto:', error);
  }
}

async function finishPartyGame() {
  try {
    await callPartyRpc('finish_party_member', { p_party_id: state.partySnapshot.party.id, p_path: state.path });
    await refreshParty(state.partySnapshot.party.id);
    victory();
  } catch (error) {
    console.error(error);
  }
}

async function quitPartyGame() {
  if (state.mode !== 'party' || !state.partySnapshot) return;
  try {
    await callPartyRpc('quit_party_member', { p_party_id: state.partySnapshot.party.id });
    await refreshParty(state.partySnapshot.party.id);
  } catch (error) {
    console.error(error);
  }
}

// Sidebar TOC
function updateSidebarToc(sections) {
  state.currentTocSections = sections;
  var tocNav = document.getElementById('tocNav');
  tocNav.innerHTML = '';

  if (!sections || sections.length <= 1) {
    tocNav.innerHTML = '<li style="color: var(--text-muted); font-size: 13px;">Sem seções</li>';
    return;
  }

  var validSections = sections.filter(function(s) {
    return s.line && s.toclevel <= 3 && s.byteoffset !== undefined;
  });

  if (validSections.length === 0) {
    tocNav.innerHTML = '<li style="color: var(--text-muted); font-size: 13px;">Sem seções</li>';
    return;
  }

  // "Início" item
  var inicioLi = document.createElement('li');
  var inicioLink = document.createElement('a');
  inicioLink.className = 'inicio';
  inicioLink.textContent = 'Início';
  inicioLink.onclick = function(e) {
    e.preventDefault();
    scrollToTop();
  };
  inicioLi.appendChild(inicioLink);
  tocNav.appendChild(inicioLi);

  validSections.forEach(function(section) {
    var anchor = section.anchor || ('section-' + section.index);
    var li = document.createElement('li');
    li.style.paddingLeft = Math.max(0, section.toclevel - 1) * 16 + 'px';
    var a = document.createElement('a');
    a.textContent = section.line;
    a.href = '#' + anchor;
    a.onclick = (function(sectionAnchor) {
      return function(e) {
        e.preventDefault();
        scrollToSection(sectionAnchor);
      };
    })(anchor);
    li.appendChild(a);
    tocNav.appendChild(li);
  });
}

function scrollToTop() {
  var frame = document.getElementById('wiki-frame');
  try {
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.documentElement.scrollTop = 0;
    doc.body.scrollTop = 0;
  } catch (e) {
    console.error('Erro ao scroll:', e);
  }
}

function scrollToSection(anchor) {
  var frame = document.getElementById('wiki-frame');
  try {
    var doc = frame.contentDocument || frame.contentWindow.document;
    var element = doc.getElementById(anchor);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      console.log('Elemento não encontrado:', anchor);
    }
  } catch (e) {
    console.error('Erro ao scroll:', e);
  }
}

function toggleToc() {
  var tocList = document.getElementById('tocNav');
  var toggleBtn = document.getElementById('tocToggleBtn');
  if (tocList.style.display === 'none') {
    tocList.style.display = 'block';
    toggleBtn.textContent = 'ocultar';
  } else {
    tocList.style.display = 'none';
    toggleBtn.textContent = 'mostrar';
  }
}

// Article loading
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

function loadArticle(title, addToPath) {
  if (addToPath === undefined) addToPath = true;
  showLoading(true);
  
  return getArticleHtml(title)
    .then(function(result) {
      var fullPage = buildWikiPage(fixRelativeUrls(result.html), title, result.sections);
      var frame = document.getElementById('wiki-frame');
      
      frame.srcdoc = fullPage;
      
      state.currentArticle = title;

      if (addToPath) {
        if (state.path.length === 0 || state.path[state.path.length - 1] !== title) {
          state.path.push(title);
        }
      }

      updateHistory();
      updateSidebarToc(result.sections);

      // Wait for iframe to load
      frame.onload = function() {
        interceptLinks(frame);
        showLoading(false);
      };

      // Fallback timeout
      setTimeout(function() { showLoading(false); }, 8000);
    })
    .catch(function(err) {
      console.error('Erro ao carregar artigo:', err);
      showLoading(false);
      alert('Erro ao carregar "' + title + '". Tente novamente.');
    });
}

function normalizeTitle(title) {
  return title.replace(/ /g, '_').toLowerCase();
}

function interceptLinks(frame) {
  try {
    var doc = frame.contentDocument || frame.contentWindow.document;
    
    // Add click listener to intercept all links
    doc.addEventListener('click', function(e) {
      var link = e.target.closest('a');
      if (!link) return;

      var href = link.getAttribute('href');
      if (!href) return;

      // Handle anchor links (scroll within page)
      if (href.startsWith('#')) {
        e.preventDefault();
        e.stopPropagation();
        var anchorId = href.substring(1);
        scrollToSection(anchorId);
        return;
      }

      // Only intercept Wikipedia internal links
      var articleTitle = null;
      var wikiLinkMatch = href.match(/\/wiki\/([^#?]+)/);
      if (wikiLinkMatch) {
        articleTitle = decodeURIComponent(wikiLinkMatch[1]).replace(/_/g, ' ');
      }

      // Skip if not a wiki link
      if (!articleTitle) return;
      
      // Skip special pages
      if (articleTitle.includes(':')) return;

      e.preventDefault();
      e.stopPropagation();

      state.clicks++;
      document.getElementById('clickCount').textContent = state.clicks;
      document.getElementById('panelClicks').textContent = state.clicks;

      // Check victory
      if (normalizeTitle(articleTitle) === normalizeTitle(state.endArticle)) {
        state.path.push(state.endArticle);
        updateHistory();
        if (state.mode === 'party') finishPartyGame();
        else victory();
        return;
      }

      // Load new article
      loadArticle(articleTitle, true).then(syncPartyProgress);
    }, true); // Use capture phase to intercept before default behavior

    console.log('Links interceptados com sucesso');
  } catch (e) {
    console.error('Erro ao interceptar links:', e);
  }
}

function navigateToArticle(title, pathIndex) {
  state.path = state.path.slice(0, pathIndex + 1);
  updateHistory();
  return loadArticle(title, false);
}

// Victory
function victory() {
  stopTimer();
  state.playing = false;

  document.getElementById('finalClicks').textContent = state.clicks;
  document.getElementById('finalTime').textContent = getElapsedTime();

  var pathHtml = state.path.map(function(t, i) {
    return '<span>' + (i + 1) + '.</span> ' + t;
  }).join(' → ');
  document.getElementById('victoryPath').innerHTML = pathHtml;

  document.getElementById('victoryOverlay').classList.remove('hidden');
}

// Start game
function startSoloGame() {
  state.mode = 'solo';
  unsubscribeFromParty();
  startGame();
}

function startGame() {
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('appContainer').style.display = 'flex';
  document.getElementById('victoryOverlay').classList.add('hidden');

  state.path = [];
  state.currentArticle = null;
  state.clicks = 0;
  state.playing = true;
  document.getElementById('clickCount').textContent = '0';
  document.getElementById('panelClicks').textContent = '0';
  document.getElementById('timer').textContent = '0:00';
  document.getElementById('panelTimer').textContent = '0:00';

  showLoading(true);
  getRandomArticles(2)
    .then(function(articles) {
      state.startArticle = articles[0].title;
      state.endArticle = articles[1].title;

      if (normalizeTitle(state.startArticle) === normalizeTitle(state.endArticle)) {
        return getRandomArticles(1).then(function(extra) {
          state.endArticle = extra[0].title;
        });
      }
    })
    .then(function() {
      var startTitleEl = document.getElementById('startTitle');
      var endTitleEl = document.getElementById('endTitle');

      startTitleEl.textContent = state.startArticle;
      endTitleEl.textContent = state.endArticle;

      attachTooltipEvents(startTitleEl, state.startArticle);
      attachTooltipEvents(endTitleEl, state.endArticle);

      startTimer();
      return loadArticle(state.startArticle, true);
    })
    .catch(function(err) {
      console.error('Erro ao iniciar jogo:', err);
      showLoading(false);
      alert('Erro ao buscar artigos. Verifique sua conexão.');
      showStartScreen();
    });
}

function playAgain() {
  document.getElementById('victoryOverlay').classList.add('hidden');
  startGame();
}

// Observe tooltip visibility
var tooltip = document.getElementById('wikiTooltip');
var observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(m) {
    tooltip._visible = m.target.classList.contains('visible');
  });
});
observer.observe(tooltip, { attributes: true, attributeFilter: ['class'] });
