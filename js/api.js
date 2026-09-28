// Wikipedia API functions
const WIKI_API = 'https://pt.wikipedia.org/w/api.php';
const articleSummaryCache = {};
const articleCategoriesCache = {};

const UNSUITABLE_ARTICLE_PATTERN = /^(Lista de|Anexo:|Categoria:|Wikipédia:|Portal:|Predefinição:|\d{1,4}|\d{1,2} de [a-zç]+)/i;
const GENERIC_CATEGORIES = [
  '!artigos', '!páginas', 'wikipédia', '!predefinições', 'cs1', 'verificação',
  'manutenção', 'esboços', 'portais', 'wikidata', 'identificadores'
];

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

function summaryFromPage(page) {
  if (!page || Object.prototype.hasOwnProperty.call(page, 'missing')) return null;
  const extract = (page.extract || page.description || '').replace(/\s+/g, ' ').trim();
  return {
    title: page.title,
    description: shortenDescription(extract, 520) || 'Sem resumo disponível para este artigo.',
    image: page.thumbnail ? page.thumbnail.source : null
  };
}

function getArticleSummaries(titles) {
  if (!titles.length) return Promise.resolve([]);
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'extracts|pageimages|description',
    exintro: '1',
    exsentences: '4',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '320',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  return wikiFetch(params).then(function(data) {
    const pages = data.query && data.query.pages ? data.query.pages : {};
    return Object.keys(pages).map(function(pageId) {
      var summary = summaryFromPage(pages[pageId]);
      if (summary) articleSummaryCache[summary.title] = Promise.resolve(summary);
      return summary;
    }).filter(Boolean);
  });
}

function isSuitableArticle(title) {
  return title && title.length <= 80 && !UNSUITABLE_ARTICLE_PATTERN.test(title);
}

function normalizeCategory(title) {
  return title.replace(/^Categoria:/, '').toLocaleLowerCase('pt-BR');
}

function isUsefulCategory(title) {
  var normalized = normalizeCategory(title);
  return !GENERIC_CATEGORIES.some(function(term) { return normalized.indexOf(term) !== -1; });
}

function getArticleCategories(title) {
  if (articleCategoriesCache[title]) return articleCategoriesCache[title];
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'categories',
    cllimit: 'max',
    clshow: '!hidden',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  articleCategoriesCache[title] = wikiFetch(params).then(function(data) {
    const pages = data.query && data.query.pages ? data.query.pages : {};
    const page = pages[Object.keys(pages)[0]];
    return page && page.categories
      ? page.categories.map(function(category) { return normalizeCategory(category.title); }).filter(isUsefulCategory)
      : [];
  }).catch(function() {
    delete articleCategoriesCache[title];
    return [];
  });
  return articleCategoriesCache[title];
}

function getCandidateCategories(titles) {
  if (!titles.length) return Promise.resolve({});
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'categories',
    cllimit: 'max',
    clshow: '!hidden',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  return wikiFetch(params).then(function(data) {
    const result = {};
    const pages = data.query && data.query.pages ? data.query.pages : {};
    Object.keys(pages).forEach(function(pageId) {
      var page = pages[pageId];
      result[page.title] = (page.categories || [])
        .map(function(category) { return normalizeCategory(category.title); })
        .filter(isUsefulCategory);
    });
    return result;
  }).catch(function() { return {}; });
}

function categorySimilarity(categories, referenceCategories) {
  if (!categories.length || !referenceCategories.length) return 0;
  var reference = new Set(referenceCategories);
  return categories.reduce(function(score, category) {
    if (reference.has(category)) return score + 4;
    var categoryWords = category.split(/\s+/).filter(function(word) { return word.length > 4; });
    var related = referenceCategories.some(function(referenceCategory) {
      return categoryWords.some(function(word) { return referenceCategory.indexOf(word) !== -1; });
    });
    return score + (related ? 1 : 0);
  }, 0);
}

function chooseRelatedLink(links, route, referenceCategories) {
  var candidates = links.filter(function(title) {
    return route.indexOf(title) === -1 && isSuitableArticle(title);
  });
  if (!candidates.length) return Promise.reject(new Error('Artigo sem links internos utilizáveis.'));

  // Avaliar uma amostra mantém as requisições leves sem perder a variedade das partidas.
  candidates.sort(function() { return Math.random() - 0.5; });
  var sample = candidates.slice(0, 24);
  return getCandidateCategories(sample).then(function(categoriesByTitle) {
    var ranked = sample.map(function(title) {
      var categories = categoriesByTitle[title] || [];
      return {
        title: title,
        score: categorySimilarity(categories, referenceCategories) + Math.random() * 1.5
      };
    }).sort(function(a, b) { return b.score - a.score; });
    return ranked[0].title;
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
      return page && page.links ? page.links
        .filter(function(link) {
          return link.title && !Object.prototype.hasOwnProperty.call(link, 'missing') && !Object.prototype.hasOwnProperty.call(link, 'invalid');
        })
        .map(function(link) { return link.title; }) : [];
    });
}

function getConnectedRoute(length) {
  function continueFrom(route, referenceCategories) {
    if (route.length >= length) return Promise.resolve(route);
    return getArticleLinks(route[route.length - 1]).then(function(links) {
      return chooseRelatedLink(links, route, referenceCategories);
    }).then(function(nextTitle) {
      route.push(nextTitle);
      return getArticleCategories(nextTitle).then(function(nextCategories) {
        var expandedReference = referenceCategories.concat(nextCategories).filter(function(category, index, all) {
          return all.indexOf(category) === index;
        });
        return continueFrom(route, expandedReference.slice(0, 80));
      });
    });
  }

  return getRandomArticles(10).then(function(articles) {
    var candidates = articles.filter(function(article) { return isSuitableArticle(article.title); });
    return getArticleSummaries(candidates.map(function(article) { return article.title; }));
  }).then(function(summaries) {
    var suitable = summaries.filter(function(summary) {
      return summary.description.length >= 120 && isSuitableArticle(summary.title);
    });
    var selected = suitable.length ? suitable[Math.floor(Math.random() * suitable.length)] : summaries[0];
    if (!selected) throw new Error('Nenhum artigo inicial adequado foi encontrado.');
    return getArticleCategories(selected.title).then(function(categories) {
      return continueFrom([selected.title], categories);
    });
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
    redirects: '1',
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
    exsentences: '4',
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

      return summaryFromPage(pages[pageId]);
    })
    .catch(function() {
      delete articleSummaryCache[title];
      return null;
    });
  return articleSummaryCache[title];
}

function shortenDescription(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  var excerpt = text.slice(0, maxLength + 1);
  var sentenceEnd = Math.max(excerpt.lastIndexOf('. '), excerpt.lastIndexOf('! '), excerpt.lastIndexOf('? '));
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) return excerpt.slice(0, sentenceEnd + 1).trim();
  var lastSpace = excerpt.lastIndexOf(' ', maxLength - 1);
  return excerpt.slice(0, lastSpace > 0 ? lastSpace : maxLength).trimEnd() + '…';
}
