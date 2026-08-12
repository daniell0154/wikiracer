// Wikipedia API functions
const WIKI_API = 'https://pt.wikipedia.org/w/api.php';
const articleSummaryCache = {};

function wikiFetch(params) {
  return fetch(WIKI_API + '?' + params.toString()).then(function(res) {
    if (!res.ok) throw new Error('Wikipedia respondeu ' + res.status + '.');
    return res.json();
  });
}

function getRandomArticles(count) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'random',
    rnnamespace: '0',
    rnlimit: count,
    format: 'json',
    origin: '*',
  });
  return wikiFetch(params)
    .then(function(data) {
      return data.query.random.map(function(a) { return { title: a.title, id: a.id }; });
    });
}

function getArticleLinks(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'links',
    plnamespace: '0',
    pllimit: 'max',
    format: 'json',
    origin: '*',
  });
  return wikiFetch(params)
    .then(function(data) {
      const pages = data.query && data.query.pages ? data.query.pages : {};
      const page = pages[Object.keys(pages)[0]];
      return page && page.links ? page.links.map(function(link) { return link.title; }) : [];
    });
}

function getConnectedRoute(length) {
  function continueFrom(route) {
    if (route.length >= length) return Promise.resolve(route);
    return getArticleLinks(route[route.length - 1]).then(function(links) {
      var candidates = links.filter(function(title) {
        return route.indexOf(title) === -1 && title.length <= 80;
      });
      if (!candidates.length) throw new Error('Artigo sem links internos utilizáveis.');
      route.push(candidates[Math.floor(Math.random() * candidates.length)]);
      return continueFrom(route);
    });
  }

  return getRandomArticles(1).then(function(articles) {
    return continueFrom([articles[0].title]);
  });
}

function getBalancedRoute(length, attempts) {
  var remaining = attempts || 3;
  return getConnectedRoute(length).catch(function(error) {
    if (remaining <= 1) throw error;
    return getBalancedRoute(length, remaining - 1);
  });
}

function getArticleHtml(title) {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    format: 'json',
    origin: '*',
    prop: 'text|sections',
    disableeditsection: '1',
  });
  return wikiFetch(params)
    .then(function(data) {
      if (data.error) throw new Error(data.error.info);
      return { html: data.parse.text['*'], sections: data.parse.sections || [] };
    });
}

function getArticleSummary(title) {
  if (articleSummaryCache[title]) return articleSummaryCache[title];
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts|pageimages|description',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '320',
    format: 'json',
    origin: '*',
  });
  articleSummaryCache[title] = wikiFetch(params)
    .then(function(data) {
      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];
      if (pageId === '-1') return null;

      const page = pages[pageId];
      const extract = page.extract || page.description || '';
      const description = extract.length > 280 ? extract.slice(0, 277).trimEnd() + '…' : extract;

      return {
        title: page.title,
        description: description || 'Sem resumo disponível para este artigo.',
        image: page.thumbnail ? page.thumbnail.source : null
      };
    })
    .catch(function() {
      delete articleSummaryCache[title];
      return null;
    });
  return articleSummaryCache[title];
}
