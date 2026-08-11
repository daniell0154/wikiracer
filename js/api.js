// Wikipedia API functions
const WIKI_API = 'https://pt.wikipedia.org/w/api.php';

function getRandomArticles(count) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'random',
    rnnamespace: '0',
    rnlimit: count,
    format: 'json',
    origin: '*',
  });
  return fetch(WIKI_API + '?' + params.toString())
    .then(function(res) { return res.json(); })
    .then(function(data) {
      return data.query.random.map(function(a) { return { title: a.title, id: a.id }; });
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
  return fetch(WIKI_API + '?' + params.toString())
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error.info);
      return { html: data.parse.text['*'], sections: data.parse.sections || [] };
    });
}

function getArticleSummary(title) {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    origin: '*',
  });
  return fetch(WIKI_API + '?' + params.toString())
    .then(function(res) { return res.json(); })
    .then(function(data) {
      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];
      if (pageId === '-1') return null;

      const page = pages[pageId];
      const extract = page.extract || '';
      const firstSentence = extract.split('.')[0] + '.';
      const description = firstSentence.length > 200
        ? firstSentence.substring(0, 200).split('.').slice(0, -1).join('.') + '.'
        : firstSentence;

      return { title: page.title, description: description };
    })
    .catch(function() { return null; });
}
